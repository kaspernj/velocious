// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import * as inflection from "inflection";
import isPlainObject from "../utils/plain-object.js";
import { modelPrimaryKeyConditions, readModelPrimaryKeyValue, scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
import VelociousError from "../velocious-error.js";
/**
 * Backend or frontend model class bound to a frontend-model resource.
 * @typedef {import("../authorization/base-resource.js").AuthorizationResourceModelClass & {attachmentDefinitions: () => Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration>, primaryKey: () => import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition}} FrontendModelResourceModelClass
 */
/**
 * Built-in frontend-model resource action.
 * @typedef {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} FrontendModelResourceAction
 */
/**
 * Options for building an authorized frontend-model resource query.
 * @typedef {object} FrontendModelResourceAuthorizedQueryOptions
 * @property {() => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>} [ruleQueryFactory] - Query factory used when authorization must target a captured record snapshot.
 */
/**
 * Frontend-model controller methods used by resources.
 * @typedef {import("../controller.js").default & {
 *   currentAbility: () => import("../authorization/ability.js").default | undefined,
 *   applyFrontendModelPagination: (args: {pagination: FrontendModelResourcePagination, query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>}) => void,
 *   applyFrontendModelSearch: (args: {query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>, search: FrontendModelResourceSearch}) => void,
 *   applyFrontendModelSort: (args: {query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>, sort: FrontendModelResourceSort}) => void,
 *   ensureFrontendModelJoinPath: (args: {path: string[], query: import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>}) => void,
 *   frontendModelAbilityAction: (action: FrontendModelResourceAction) => string,
 *   frontendModelAbilityAuthorizedQuery: (action: FrontendModelResourceAction, options?: FrontendModelResourceAuthorizedQueryOptions) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
 *   frontendModelAuthorizedQuery: (action: FrontendModelResourceAction, options?: FrontendModelResourceAuthorizedQueryOptions) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
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
 * @template {typeof import("../database/record/index.js").default} [TDatabaseModelClass=typeof import("../database/record/index.js").default]
 * @typedef {object} FrontendModelResourceControllerArgs
 * @property {FrontendModelResourceController} controller - Frontend-model controller instance.
 * @property {TDatabaseModelClass} modelClass - Backing model class.
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
 * Internal constructor contract used when a resource instantiates its shared
 * counterpart across the frontend/backend model boundary.
 * @template {FrontendModelResourceModelClass} TModelClass
 * @template {typeof import("../database/record/index.js").default} TDatabaseModelClass
 * @typedef {{new (args: FrontendModelResourceAbilityArgs<FrontendModelResourceModelClass> | FrontendModelResourceControllerArgs): FrontendModelBaseResource<TModelClass, TDatabaseModelClass>}} FrontendModelResourceInternalConstructor
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
 * @typedef {FrontendModelResourceAttributePayload & {id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, _destroy?: boolean, attributes?: FrontendModelResourceAttributePayload, attachments?: FrontendModelResourceAttributePayload, nestedAttributes?: FrontendModelResourceAttributePayload}} FrontendModelResourceNestedEntry
 */
/**
 * Narrows an unbound resource registry entry at framework-owned construction
 * sites where the backing database model has already been resolved.
 * @param {import("../configuration-types.js").FrontendModelResourceClassType} ResourceClass - Unbound resource class.
 * @returns {FrontendModelResourceInternalConstructor<typeof import("../database/record/index.js").default, typeof import("../database/record/index.js").default>} Runtime constructor.
 */
export function frontendModelResourceInternalConstructor(ResourceClass) {
    return /** @type {FrontendModelResourceInternalConstructor<typeof import("../database/record/index.js").default, typeof import("../database/record/index.js").default>} */ ( /** @type {unknown} */(ResourceClass));
}
const QUICK_SEARCH_COLUMN = "quickSearch";
/**
 * Base class for backend frontend-model resources.
 * @template {FrontendModelResourceModelClass} [TModelClass=typeof import("../database/record/index.js").default]
 * @template {typeof import("../database/record/index.js").default} [TDatabaseModelClass=Extract<TModelClass, typeof import("../database/record/index.js").default>]
 */
export default class FrontendModelBaseResource extends AuthorizationBaseResource {
    /** @type {FrontendModelResourceModelClass | undefined} */
    static ModelClass = undefined;
    /** @type {Record<string, ReturnType<typeof JSON.parse>> | string[] | undefined} */
    static attributes = undefined;
    /** @type {string[] | undefined} */
    static abilities = undefined;
    /** @type {Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration> | undefined} */
    static attachments = undefined;
    /** @type {string[] | undefined} */
    static commands = undefined;
    /** @type {string[] | undefined} */
    static collectionCommands = undefined;
    /** @type {string[] | undefined} */
    static builtInCollectionCommands = undefined;
    /** @type {string[] | undefined} */
    static memberCommands = undefined;
    /** @type {string[] | undefined} */
    static builtInMemberCommands = undefined;
    /** @type {string[] | undefined} */
    static relationships = undefined;
    /** @type {string | undefined} */
    static modelName = undefined;
    /** @type {string | string[] | undefined} */
    static primaryKey = undefined;
    /** @type {import("../configuration-types.js").FrontendModelResourceServerConfiguration | undefined} */
    static server = undefined;
    /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean | undefined} */
    static sync = undefined;
    /** @type {string[] | undefined} */
    static translatedAttributes = undefined;
    /** @type {ReturnType<typeof JSON.parse>} */
    static SharedResource = undefined;
    /**
     * Declarative quick-search text columns. When declared, an index search on
     * the pseudo-column `quickSearch` expands to an OR of LIKE conditions over
     * these columns instead of hitting the controller default. Each entry is a
     * root-table column name or a `{path, column}` pair for a joined
     * relationship path.
     * @type {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string> | null | undefined} */
    static quickSearchColumns = undefined;
    /**
     * Declarative quick-search numeric columns. When the trimmed quick-search
     * value is a safe non-negative integer, each declared column also gets an
     * exact `=` condition ORed into the quick-search predicate. Same entry shape
     * as {@link FrontendModelBaseResource.quickSearchColumns}.
     * @type {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string> | null | undefined} */
    static quickSearchNumericColumns = undefined;
    /**
     * Declarative writable-attribute permit list (camelCase attribute names)
     * used as the default {@link FrontendModelBaseResource#permittedParams} and
     * as the routed sync replay permit. Resolved through the shared resource
     * like the other static resource config: an undeclared environment list
     * falls back to the shared resource's list, while an explicit declaration
     * (including `null`) wins.
     * @type {string[] | null | undefined} */
    static writableAttributes = undefined;
    /**
     * Runs constructor.
     * @param {FrontendModelResourceAbilityArgs<TModelClass> | FrontendModelResourceControllerArgs<TDatabaseModelClass>} args - Resource args.
     */
    constructor(args) {
        super({
            ability: "ability" in args ? args.ability : undefined,
            context: "context" in args ? args.context || {} : {},
            locals: "locals" in args ? args.locals || {} : {}
        });
        // Narrows the subclass static side to the model class carried by this resource generic.
        const ResourceClass = /** @type {typeof FrontendModelBaseResource & {ModelClass: TModelClass | undefined, modelClass: () => TModelClass}} */ (this.constructor);
        const defaultResourceConfiguration = /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({ attributes: [] });
        this.controller = "controller" in args ? args.controller : undefined;
        this.configurationValue = "configuration" in args ? args.configuration : undefined;
        // Narrows the internal controller/shared-resource construction path to the resource's declared model generic.
        this.modelClassValue = /** @type {TModelClass} */ ("modelClass" in args ? args.modelClass : ResourceClass.modelClass());
        this.modelNameValue = "modelName" in args ? args.modelName : this.modelClass().getModelName();
        this.paramsValue = "params" in args ? args.params : undefined;
        this.resourceConfigurationValue = "resourceConfiguration" in args ? args.resourceConfiguration : defaultResourceConfiguration;
        /** @type {FrontendModelBaseResource<TModelClass, TDatabaseModelClass> | null | undefined} */
        this.sharedResourceInstanceValue = undefined;
    }
    /**
     * Returns the configured shared resource class.
     * @returns {ReturnType<typeof JSON.parse>} - Shared resource class.
     */
    static sharedResourceClass() {
        return this.SharedResource;
    }
    /**
     * Reads a static resource config value from the environment resource first,
     * then from the shared resource.
     * @param {"abilities" | "attachments" | "attributes" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "modelName" | "primaryKey" | "quickSearchColumns" | "quickSearchNumericColumns" | "relationships" | "server" | "sync" | "translatedAttributes" | "writableAttributes"} name - Static config property name.
     * @returns {ReturnType<typeof JSON.parse>} - Resolved config value.
     */
    static sharedResourceStaticValue(name) {
        if (this[name] !== undefined)
            return this[name];
        const SharedResource = /** @type {typeof FrontendModelBaseResource | undefined} */ (this.sharedResourceClass());
        if (!SharedResource)
            return undefined;
        if (SharedResource[name] !== undefined)
            return SharedResource[name];
        return undefined;
    }
    /**
     * Resolves translated attributes from environment and shared resources.
     * @returns {string[] | undefined} - Translated attribute names.
     */
    static translatedAttributesConfig() {
        return /** @type {string[] | undefined} */ (this.sharedResourceStaticValue("translatedAttributes"));
    }
    /**
     * Resolves frontend-safe attachment declarations from the backing model.
     * Resource-level declarations remain as a fallback for frontend-only resources.
     * @returns {Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration>} - Client attachment configuration keyed by name.
     */
    static attachmentConfigurations() {
        const configuredAttachments = /** @type {Record<string, import("../configuration-types.js").FrontendModelAttachmentConfiguration> | undefined} */ (this.sharedResourceStaticValue("attachments"));
        const attachments = configuredAttachments ? { ...configuredAttachments } : {};
        if (!this.ModelClass)
            return attachments;
        for (const [attachmentName, definition] of Object.entries(this.ModelClass.attachmentDefinitions())) {
            const attachmentConfig = /** @type {import("../configuration-types.js").FrontendModelAttachmentConfiguration} */ ({ type: definition.type });
            if (definition.sync)
                attachmentConfig.sync = { ...definition.sync };
            attachments[attachmentName] = attachmentConfig;
        }
        return attachments;
    }
    /**
     * Builds a resource instance for shared-resource fallback calls.
     * @returns {FrontendModelBaseResource<TModelClass, TDatabaseModelClass> | null} - Shared resource instance when configured.
     */
    sharedResourceInstance() {
        if (this.sharedResourceInstanceValue !== undefined)
            return this.sharedResourceInstanceValue;
        const ResourceClass = /** @type {import("../configuration-types.js").FrontendModelResourceClassType<TModelClass, TDatabaseModelClass>} */ (this.constructor);
        const SharedResource = /** @type {import("../configuration-types.js").FrontendModelResourceClassType<TModelClass, TDatabaseModelClass> | undefined} */ (ResourceClass.sharedResourceClass());
        if (!SharedResource) {
            this.sharedResourceInstanceValue = null;
            return this.sharedResourceInstanceValue;
        }
        if (SharedResource === ResourceClass) {
            throw new Error(`${ResourceClass.name}.SharedResource cannot point to itself.`);
        }
        const SharedResourceConstructor = /** @type {FrontendModelResourceInternalConstructor<TModelClass, TDatabaseModelClass>} */ ( /** @type {unknown} */(SharedResource));
        const sharedResource = new SharedResourceConstructor({
            ability: this.ability,
            controller: this.controller,
            context: this.context,
            locals: this.locals,
            modelClass: this.modelClass(),
            modelName: this.modelName(),
            params: this.params(),
            resourceConfiguration: this.resourceConfiguration()
        });
        this.sharedResourceInstanceValue = sharedResource;
        return sharedResource;
    }
    /**
     * Calls a shared-resource method only when the shared resource overrides the framework default.
     * @param {string} methodName - Method name to resolve.
     * @param {unknown[]} args - Method args.
     * @returns {{called: boolean, result: unknown}} - Shared method call result.
     */
    callSharedResourceMethod(methodName, args) {
        const sharedResource = this.sharedResourceInstance();
        if (!sharedResource)
            return { called: false, result: undefined };
        const methodOwner = prototypeOwnerForMethod(sharedResource, methodName);
        if (!methodOwner || methodOwner === FrontendModelBaseResource.prototype || methodOwner === AuthorizationBaseResource.prototype) {
            return { called: false, result: undefined };
        }
        const method = /** @type {Record<string, (...methodArgs: unknown[]) => unknown>} */ ( /** @type {unknown} */(sharedResource))[methodName];
        return { called: true, result: method.apply(sharedResource, args) };
    }
    /**
     * Runs shared method result or a fallback callback.
     * @template Result
     * @param {string} methodName - Shared method name.
     * @param {unknown[]} args - Shared method args.
     * @param {() => Result} fallback - Fallback callback.
     * @returns {Result} - Shared or fallback result.
     */
    sharedResourceMethodOr(methodName, args, fallback) {
        const sharedResult = this.callSharedResourceMethod(methodName, args);
        if (sharedResult.called)
            return /** @type {Result} */ (sharedResult.result);
        return fallback();
    }
    /**
     * Resolves a method on this resource or its shared fallback.
     * @param {string} methodName - Method name.
     * @returns {{method: (...methodArgs: unknown[]) => unknown, resource: FrontendModelBaseResource<TModelClass, TDatabaseModelClass>} | null} - Resolved method and receiver.
     */
    resourceMethod(methodName) {
        const ownMethod = /** @type {Record<string, unknown>} */ ( /** @type {unknown} */(this))[methodName];
        if (typeof ownMethod === "function") {
            return {
                method: /** @type {(...methodArgs: unknown[]) => unknown} */ (ownMethod),
                resource: this
            };
        }
        const sharedResource = this.sharedResourceInstance();
        if (!sharedResource)
            return null;
        const sharedMethod = /** @type {Record<string, unknown>} */ ( /** @type {unknown} */(sharedResource))[methodName];
        if (typeof sharedMethod !== "function")
            return null;
        return {
            method: /** @type {(...methodArgs: unknown[]) => unknown} */ (sharedMethod),
            resource: sharedResource
        };
    }
    /**
     * Runs abilities.
     * @returns {void} - No return value.
     */
    abilities() {
        this.sharedResourceMethodOr("abilities", [], () => undefined);
    }
    /**
     * Runs typed controller instance.
     * @returns {FrontendModelResourceController} - Controller instance with frontend-model helpers.
     */
    typedControllerInstance() {
        return /** @type {FrontendModelResourceController} */ (this.controller);
    }
    /**
     * Runs resource config.
     * @returns {import("../configuration-types.js").FrontendModelResourceConfiguration} - Static resource config (raw user input shape; consumers normalize).
     */
    static resourceConfig() {
        const attributes = this.sharedResourceStaticValue("attributes");
        const abilities = this.sharedResourceStaticValue("abilities");
        const attachments = this.attachmentConfigurations();
        const commands = this.sharedResourceStaticValue("commands");
        const builtInCollectionCommands = this.sharedResourceStaticValue("builtInCollectionCommands");
        const builtInMemberCommands = this.sharedResourceStaticValue("builtInMemberCommands");
        const collectionCommands = this.sharedResourceStaticValue("collectionCommands");
        const memberCommands = this.sharedResourceStaticValue("memberCommands");
        const modelName = this.sharedResourceStaticValue("modelName");
        const primaryKey = this.sharedResourceStaticValue("primaryKey");
        const quickSearchColumns = this.sharedResourceStaticValue("quickSearchColumns");
        const quickSearchNumericColumns = this.sharedResourceStaticValue("quickSearchNumericColumns");
        const relationships = this.sharedResourceStaticValue("relationships");
        const server = this.sharedResourceStaticValue("server");
        const sync = this.sharedResourceStaticValue("sync");
        /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */
        const config = {
            attributes: /** @type {Record<string, ReturnType<typeof JSON.parse>> | string[]} */ (attributes || [])
        };
        if (abilities)
            config.abilities = /** @type {string[]} */ (abilities);
        if (Object.keys(attachments).length > 0)
            config.attachments = attachments;
        if (commands)
            config.commands = /** @type {string[]} */ (commands);
        if (builtInCollectionCommands)
            config.builtInCollectionCommands = /** @type {string[]} */ (builtInCollectionCommands);
        if (builtInMemberCommands)
            config.builtInMemberCommands = /** @type {string[]} */ (builtInMemberCommands);
        if (collectionCommands)
            config.collectionCommands = /** @type {string[]} */ (collectionCommands);
        if (memberCommands)
            config.memberCommands = /** @type {string[]} */ (memberCommands);
        if (modelName)
            config.modelName = /** @type {string} */ (modelName);
        if (primaryKey)
            config.primaryKey = /** @type {string | string[]} */ (primaryKey);
        if (quickSearchColumns !== undefined)
            config.quickSearchColumns = /** @type {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string>} */ (quickSearchColumns);
        if (quickSearchNumericColumns !== undefined)
            config.quickSearchNumericColumns = /** @type {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string>} */ (quickSearchNumericColumns);
        if (relationships)
            config.relationships = /** @type {string[]} */ (relationships);
        if (server)
            config.server = /** @type {import("../configuration-types.js").FrontendModelResourceServerConfiguration} */ (server);
        if (sync !== undefined)
            config.sync = /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean} */ (sync);
        return config;
    }
    /**
     * Resolves the client-facing resource primary key from explicit resource config or the backing model.
     * @param {import("../configuration-types.js").FrontendModelResourceConfiguration | import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} resourceConfiguration - Resource configuration.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Client-facing primary key.
     */
    static resolvedPrimaryKey(resourceConfiguration) {
        if (resourceConfiguration.primaryKey)
            return resourceConfiguration.primaryKey;
        if (!this.ModelClass)
            return "id";
        const modelClass = /** @type {typeof import("../database/record/index.js").default} */ (this.modelClass());
        const modelPrimaryKey = modelClass.primaryKey();
        return Array.isArray(modelPrimaryKey)
            ? modelPrimaryKey.map((columnName) => modelClass.resolveAttributeName(columnName) || columnName)
            : modelClass.resolveAttributeName(modelPrimaryKey) || modelPrimaryKey;
    }
    /**
     * Runs controller instance.
     * @returns {import("../controller.js").default} - Controller instance.
     */
    controllerInstance() {
        if (!this.controller)
            throw new Error(`${this.constructor.name} requires a controller instance.`);
        return this.controller;
    }
    /**
     * Returns the Velocious configuration: the controller's when the resource
     * serves a controller request, otherwise the constructor-injected
     * configuration (for example a sync websocket channel's resource).
     * @returns {import("../configuration.js").default} - Velocious configuration.
     */
    configuration() {
        if (this.controller)
            return this.controllerInstance().getConfiguration();
        if (this.configurationValue)
            return this.configurationValue;
        throw new Error(`${this.constructor.name} requires a controller or an injected configuration.`);
    }
    /**
     * Runs model class.
     * @returns {TModelClass} - Model class.
     */
    modelClass() {
        if (!this.modelClassValue) {
            throw new Error(`${this.constructor.name} requires a model class.`);
        }
        return this.modelClassValue;
    }
    /**
     * Returns the database model class used by server-only resource operations.
     * @returns {TDatabaseModelClass} - Database model class.
     */
    databaseModelClass() {
        // Narrows the portable resource generic at the explicit backend-operation boundary.
        return /** @type {TDatabaseModelClass} */ ( /** @type {unknown} */(this.modelClass()));
    }
    /**
     * Runs required model class for authorization helpers.
     * @returns {TModelClass} - Backing model class.
     */
    requiredModelClass() {
        return this.modelClass();
    }
    /**
     * Runs model name.
     * @returns {string} - Model name.
     */
    modelName() {
        if (!this.modelNameValue)
            throw new Error(`${this.constructor.name} requires a model name.`);
        return this.modelNameValue;
    }
    /**
     * Runs params.
     * @returns {import("../configuration-types.js").VelociousParams} - Params.
     */
    params() { return /** @type {import("../configuration-types.js").VelociousParams} */ (this.paramsValue || super.params() || {}); }
    /**
     * Runs resource configuration.
     * @returns {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | import("../configuration-types.js").FrontendModelResourceConfiguration} - Resource config (normalized at runtime; raw during early bootstrap).
     */
    resourceConfiguration() {
        if (!this.resourceConfigurationValue)
            throw new Error(`${this.constructor.name} requires a resource configuration.`);
        return this.resourceConfigurationValue;
    }
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
    permittedParams(arg) {
        return this.sharedResourceMethodOr("permittedParams", [arg], () => {
            void arg;
            return this.declaredWritableAttributes() ?? [];
        });
    }
    /**
     * Resolves the declared writable-attribute permit list from the environment
     * resource first, then the shared resource — mirroring how the other
     * static resource config resolves. An explicit environment declaration
     * (including `null`) wins over the shared resource's list.
     * @returns {string[] | null} Declared permit list or null when undeclared.
     */
    declaredWritableAttributes() {
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        const permittedAttributes = /** @type {string[] | null | undefined} */ (ResourceClass.sharedResourceStaticValue("writableAttributes"));
        return permittedAttributes ?? null;
    }
    /**
     * Builds the client-safe error thrown for a failed writable-attribute validation.
     * @param {string} message - Human-readable validation message.
     * @param {{cause?: Error, code: string}} details - Stable machine-readable code and optional cause.
     * @returns {Error} Client-safe error.
     */
    writableAttributeError(message, { cause, code }) {
        return VelociousError.safe(message, cause ? { cause, code } : { code });
    }
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
    authorizeSyncMutation({ context, mutation }) {
        void context;
        void mutation;
        return { allowed: true };
    }
    /**
     * Returns the per-sync failure reason reported when a routed sync mutation
     * fails record-level authorization. Defaults to null, which reports the
     * generic "access-denied" reason.
     * @param {object} args - Options.
     * @param {"create" | "destroy" | "update"} args.action - Denied action.
     * @param {FrontendModelSyncMutation} args.mutation - Normalized replay mutation.
     * @returns {string | null} Stable failure reason code or null for the generic default.
     */
    syncAuthorizationFailureReason({ action, mutation }) {
        void action;
        void mutation;
        return null;
    }
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
    async findSyncRecord({ ability = this.ability, forDelete = false, mutation }) {
        const ModelClass = this.databaseModelClass();
        const query = ability
            ? ModelClass.accessibleFor(this.syncAbilityAction(forDelete ? "destroy" : "update"), ability)
            : ModelClass.where({});
        return await query.findBy(modelPrimaryKeyConditions(this.databasePrimaryKey(), mutation.resourceId));
    }
    /**
     * Maps a raw sync action to the resource's normalized ability action when
     * the resource configuration declares an abilities mapping, otherwise the
     * raw action name is used directly.
     * @param {"create" | "destroy" | "update"} action - Raw sync action.
     * @returns {string} Ability action.
     */
    syncAbilityAction(action) {
        const abilities = this.resourceConfigurationValue?.abilities;
        if (abilities && typeof abilities == "object" && !Array.isArray(abilities)) {
            const abilityAction = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (abilities)[action];
            if (typeof abilityAction == "string" && abilityAction.length > 0)
                return abilityAction;
        }
        return action;
    }
    /**
     * Full escape hatch for routed sync mutation application. Returning a
     * non-null result replaces the whole default apply flow (authorization,
     * record lookup, normalization and save) with the returned apply result.
     * @param {FrontendModelApplySyncArgs} args - Apply args.
     * @returns {FrontendModelSyncApplyResult | null | Promise<FrontendModelSyncApplyResult | null>} Apply result or null for the default flow.
     */
    applySync(args) {
        void args;
        return null;
    }
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
    afterSyncApply({ context, created, mutation, record }) {
        void context;
        void created;
        void mutation;
        void record;
        return {};
    }
    /**
     * Normalizes create attributes before permission filtering and saving.
     * @param {FrontendModelResourceAttributePayload} attributes - Incoming create attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>} - Normalized attributes.
     */
    normalizeCreateAttributes(attributes, options) {
        return this.sharedResourceMethodOr("normalizeCreateAttributes", [attributes, options], () => {
            void options;
            return attributes;
        });
    }
    /**
     * Normalizes update attributes before permission filtering and saving.
     * @param {import("../database/record/index.js").default} model - Existing model.
     * @param {FrontendModelResourceAttributePayload} attributes - Incoming update attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {FrontendModelResourceAttributePayload | Promise<FrontendModelResourceAttributePayload>} - Normalized attributes.
     */
    normalizeUpdateAttributes(model, attributes, options) {
        return this.sharedResourceMethodOr("normalizeUpdateAttributes", [model, attributes, options], () => {
            void model;
            void options;
            return attributes;
        });
    }
    /**
     * Runs before create.
     * @param {import("../database/record/index.js").default} model - New model before assignment/save.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized create attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    beforeCreate(model, attributes, options) {
        return this.sharedResourceMethodOr("beforeCreate", [model, attributes, options], () => {
            void model;
            void attributes;
            void options;
        });
    }
    /**
     * Runs after create.
     * @param {import("../database/record/index.js").default} model - Created model.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized create attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    afterCreate(model, attributes, options) {
        return this.sharedResourceMethodOr("afterCreate", [model, attributes, options], () => {
            void model;
            void attributes;
            void options;
        });
    }
    /**
     * Runs before update.
     * @param {import("../database/record/index.js").default} model - Existing model before assignment/save.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized update attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    beforeUpdate(model, attributes, options) {
        return this.sharedResourceMethodOr("beforeUpdate", [model, attributes, options], () => {
            void model;
            void attributes;
            void options;
        });
    }
    /**
     * Runs after update.
     * @param {import("../database/record/index.js").default} model - Updated model.
     * @param {FrontendModelResourceAttributePayload} attributes - Normalized update attributes.
     * @param {FrontendModelResourceSaveOptions} options - Save options.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    afterUpdate(model, attributes, options) {
        return this.sharedResourceMethodOr("afterUpdate", [model, attributes, options], () => {
            void model;
            void attributes;
            void options;
        });
    }
    /**
     * Runs before destroy.
     * @param {import("../database/record/index.js").default} model - Model before destroy.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    beforeDestroy(model) {
        return this.sharedResourceMethodOr("beforeDestroy", [model], () => {
            void model;
        });
    }
    /**
     * Runs after destroy.
     * @param {import("../database/record/index.js").default} model - Destroyed model.
     * @returns {void | Promise<void>} - Resolves when the hook finishes.
     */
    afterDestroy(model) {
        return this.sharedResourceMethodOr("afterDestroy", [model], () => {
            void model;
        });
    }
    /**
     * Wraps create/update/destroy resource mutations.
     * @template Result
     * @param {object} args - Transaction args.
     * @param {"create" | "update" | "destroy"} args.action - Mutation action.
     * @param {import("../database/record/index.js").default} args.model - Mutated model.
     * @param {() => Promise<Result>} args.callback - Mutation callback.
     * @returns {Promise<Result>} - Callback result.
     */
    async runMutationTransaction({ action, model, callback }) {
        return await this.sharedResourceMethodOr("runMutationTransaction", [{ action, model, callback }], async () => {
            void action;
            void model;
            return await callback();
        });
    }
    /**
     * Runs primary key.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Primary key.
     */
    primaryKey() {
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        return ResourceClass.resolvedPrimaryKey(this.resourceConfiguration());
    }
    /**
     * Runs database primary key.
     *
     * Declared scalar resource primary keys are client-facing aliases (for example
     * a camelCase name for a legacy raw-column primary key). Database-facing identity
     * operations must resolve the alias to the model's canonical attribute so where
     * and pluck clauses hit real columns, while client-facing payloads keep the alias.
     * @returns {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Primary key resolved to database-queryable attribute names.
     */
    databasePrimaryKey() {
        const primaryKey = this.primaryKey();
        if (Array.isArray(primaryKey))
            return primaryKey;
        const modelClass = this.databaseModelClass();
        return modelClass.resolveAttributeName(primaryKey) || primaryKey;
    }
    /**
     * Runs authorized query.
     * @param {FrontendModelResourceAction} action - Ability action.
     * @param {FrontendModelResourceAuthorizedQueryOptions} [options] - Authorization query options.
     * @returns {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} - Authorized query.
     */
    authorizedQuery(action, options) {
        // Narrows the controller query to this resource's model class.
        return /** @type {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} */ (this.typedControllerInstance().frontendModelAbilityAuthorizedQuery(action, options));
    }
    /**
     * Runs index query.
     * @param {FrontendModelResourceIndexQueryOptions} [options] - Query options.
     * @returns {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} - Frontend-model index query.
     */
    indexQuery(options = {}) {
        return /** @type {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} */ (this.typedControllerInstance().frontendModelIndexQuery({
            ...options,
            resource: this
        }));
    }
    /**
     * Applies frontend-model index pagination.
     * @param {object} args - Pagination args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourcePagination} args.pagination - Pagination params.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelIndexPagination({ controller, pagination, query }) {
        controller.applyFrontendModelPagination({ pagination, query });
    }
    /**
     * Applies frontend-model index searches, expanding a declared quick search
     * before falling back to the controller default.
     * @param {object} args - Search args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {FrontendModelResourceSearch} args.search - Search params.
     * @returns {void}
     */
    applyFrontendModelIndexSearch({ controller, query, search }) {
        if (this.applyQuickSearch({ controller, query, search }))
            return;
        controller.applyFrontendModelSearch({ query, search });
    }
    /**
     * Expands a `quickSearch` pseudo-column search into an OR of LIKE conditions
     * over the declared {@link FrontendModelBaseResource.quickSearchColumns}, plus
     * exact `=` conditions over {@link FrontendModelBaseResource.quickSearchNumericColumns}
     * when the trimmed value is a safe non-negative integer.
     * @param {object} args - Search args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query to filter.
     * @param {FrontendModelResourceSearch} args.search - Search payload.
     * @returns {boolean} - Whether the search was handled as a quick search.
     */
    applyQuickSearch({ controller, query, search }) {
        const quickSearchColumns = this.quickSearchColumnDefinitions();
        if (!quickSearchColumns || quickSearchColumns.length === 0)
            return false;
        if (search.path.length > 0 || search.column !== QUICK_SEARCH_COLUMN)
            return false;
        if (search.operator !== "like") {
            throw VelociousError.safe(`${this.quickSearchErrorLabel()} must use the like operator.`, { code: this.quickSearchErrorCode() });
        }
        if (typeof search.value !== "string") {
            throw VelociousError.safe(`${this.quickSearchErrorLabel()} must be a string.`, { code: this.quickSearchErrorCode() });
        }
        const trimmedValue = search.value.trim();
        if (!trimmedValue)
            return true;
        const conditions = quickSearchColumns.map((column) => (`${this.quickSearchColumnSql({ column, controller, query })} LIKE ${query.driver.quote(`%${trimmedValue}%`)}`));
        const numericSearchValue = quickSearchNumericValue(trimmedValue);
        if (numericSearchValue !== null) {
            const quickSearchNumericColumns = this.quickSearchNumericColumnDefinitions() || [];
            for (const column of quickSearchNumericColumns) {
                conditions.push(`${this.quickSearchColumnSql({ column, controller, query })} = ${query.driver.quote(numericSearchValue)}`);
            }
        }
        query.where(`(${conditions.join(" OR ")})`);
        return true;
    }
    /**
     * Resolves the declared quick-search text columns through the shared resource.
     * @returns {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string> | null | undefined} - Declared columns.
     */
    quickSearchColumnDefinitions() {
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        return /** @type {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string> | null | undefined} */ (ResourceClass.sharedResourceStaticValue("quickSearchColumns"));
    }
    /**
     * Resolves the declared quick-search numeric columns through the shared resource.
     * @returns {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string> | null | undefined} - Declared columns.
     */
    quickSearchNumericColumnDefinitions() {
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        return /** @type {Array<import("../configuration-types.js").FrontendModelQuickSearchColumn | string> | null | undefined} */ (ResourceClass.sharedResourceStaticValue("quickSearchNumericColumns"));
    }
    /**
     * Builds the quoted SQL reference for one quick-search column, adding the
     * relationship join when the column sits on a joined path.
     * @param {object} args - Column args.
     * @param {import("../configuration-types.js").FrontendModelQuickSearchColumn | string} args.column - Column declaration.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query being filtered.
     * @returns {string} - Quoted SQL column reference.
     */
    quickSearchColumnSql({ column, controller, query }) {
        const columnConfig = typeof column === "string" ? { column } : column;
        const path = columnConfig.path || [];
        if (path.length > 0) {
            controller.ensureFrontendModelJoinPath({ path, query });
        }
        const tableReference = query.getTableReferenceForJoin(...path);
        return `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnConfig.column)}`;
    }
    /**
     * Human-readable label used in invalid quick-search payload errors. Owners
     * with an established public error contract may override this.
     * @returns {string} - Error label.
     */
    quickSearchErrorLabel() {
        return "Quick search";
    }
    /**
     * Error code used for invalid quick-search payload errors. Owners with an
     * established public error contract may override this.
     * @returns {string} - Error code.
     */
    quickSearchErrorCode() {
        return "invalid-quick-search";
    }
    /**
     * Applies frontend-model index sort.
     * @param {object} args - Sort args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {FrontendModelResourceSort} args.sort - Sort params.
     * @returns {void}
     */
    applyFrontendModelIndexSort({ controller, query, sort }) {
        controller.applyFrontendModelSort({ query, sort });
    }
    /**
     * Runs supports pluck.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @returns {boolean | Promise<boolean>} - Whether pluck is supported.
     */
    supportsPluck(action) {
        void action;
        return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records;
    }
    /**
     * Runs supports count.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @returns {boolean | Promise<boolean>} - Whether count is supported.
     */
    supportsCount(action) {
        void action;
        return Object.getPrototypeOf(this).records === FrontendModelBaseResource.prototype.records ||
            Object.getPrototypeOf(this).count !== FrontendModelBaseResource.prototype.count;
    }
    /**
     * Runs before action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @returns {boolean | void | Promise<boolean | void>} - Continue processing unless false.
     */
    beforeAction(action) {
        return this.sharedResourceMethodOr("beforeAction", [action], () => {
            void action;
            // No-op by default.
        });
    }
    /**
     * Runs records.
     * @returns {Promise<import("../database/record/index.js").default[]>} - Records for index action.
     */
    async records() {
        return await this.indexQuery().toArray();
    }
    /**
     * Runs index query options for count.
     * @returns {FrontendModelResourceIndexQueryOptions} - Index query options for count.
     */
    countIndexQueryOptions() {
        return {};
    }
    /**
     * Runs count.
     * @returns {Promise<number>} - Records count for index action.
     */
    async count() {
        return await this.indexQuery(this.countIndexQueryOptions()).count();
    }
    /**
     * Runs find.
     * @param {"find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Action.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record id.
     * @returns {Promise<import("../database/record/index.js").default | null>} - Located model.
     */
    async find(action, id) {
        let query = this.authorizedQuery(action);
        const preload = action === "find" ? this.typedControllerInstance().frontendModelPreload() : null;
        if (preload) {
            query = query.preload(preload);
        }
        return await query.findBy(modelPrimaryKeyConditions(this.databasePrimaryKey(), id));
    }
    /**
     * Runs create.
     * @param {FrontendModelResourceAttributePayload} attributes - Create attributes.
     * @param {FrontendModelResourceSaveOptions} [options] - Save options.
     * @returns {Promise<import("../database/record/index.js").default>} - Created model.
     */
    async create(attributes, options = {}) {
        const normalizedAttributes = await this.normalizeCreateAttributes(attributes, options);
        const attachmentSplit = this._extractAttachmentAttributes(normalizedAttributes, options.attachments ?? null);
        const permit = parsePermittedParams(this.permittedParams({ action: "create", ability: this.ability, locals: this.locals, params: normalizedAttributes }));
        const ModelClass = this.databaseModelClass();
        const filtered = filterWritableFrontendModelAttributes(ModelClass.prototype, ModelClass, attachmentSplit.attributes, this, permit.attributes);
        const model = new ModelClass();
        return await this.runMutationTransaction({
            action: "create",
            model,
            callback: async () => {
                await this.beforeCreate(model, normalizedAttributes, options);
                const savedModel = await this._saveWithNestedAttributes({ filtered, model, options: { ...options, attachments: attachmentSplit.attachments }, permit });
                await this.afterCreate(savedModel, normalizedAttributes, options);
                return savedModel;
            }
        });
    }
    /**
     * Runs handle unauthorized created model.
     * @param {import("../database/record/index.js").default} model - Created model.
     * @returns {Promise<void>} - Cleanup after failed authorization.
     */
    async handleUnauthorizedCreatedModel(model) {
        await model.destroy();
    }
    /**
     * Runs update.
     * @param {import("../database/record/index.js").default} model - Existing model.
     * @param {FrontendModelResourceAttributePayload} attributes - Update attributes.
     * @param {FrontendModelResourceSaveOptions} [options] - Save options.
     * @returns {Promise<import("../database/record/index.js").default>} - Updated model.
     */
    async update(model, attributes, options = {}) {
        const normalizedAttributes = await this.normalizeUpdateAttributes(model, attributes, options);
        const attachmentSplit = this._extractAttachmentAttributes(normalizedAttributes, options.attachments ?? null);
        const permit = parsePermittedParams(this.permittedParams({ action: "update", ability: this.ability, locals: this.locals, params: normalizedAttributes }));
        const filtered = filterWritableFrontendModelAttributes(model, model.getModelClass(), attachmentSplit.attributes, this, permit.attributes);
        return await this.runMutationTransaction({
            action: "update",
            model,
            callback: async () => {
                await this.beforeUpdate(model, normalizedAttributes, options);
                const savedModel = await this._saveWithNestedAttributes({ filtered, model, options: { ...options, attachments: attachmentSplit.attachments }, permit });
                await this.afterUpdate(savedModel, normalizedAttributes, options);
                return savedModel;
            }
        });
    }
    /**
     * Saves a model and applies nested attributes in one transaction.
     * @param {{filtered: Record<string, ReturnType<typeof JSON.parse>>, model: import("../database/record/index.js").default, options: FrontendModelResourceSaveOptions, permit: {attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}}} args - Save arguments.
     * @returns {Promise<import("../database/record/index.js").default>} - Saved model.
     */
    async _saveWithNestedAttributes({ filtered, model, options, permit }) {
        await this.databaseModelClass().transaction(async () => {
            await this._assignWithVirtualSetters(model, filtered);
            this._assignAttachments(model, options.attachments ?? null, permit.attributes);
            if (options.nestedAttributes) {
                await this._applyBelongsToNestedAttributes(model, options.nestedAttributes, options.controller || null, permit);
            }
            await model.save();
            if (options.nestedAttributes) {
                await this._applyNestedAttributes(model, options.nestedAttributes, options.controller || null, permit);
            }
        });
        await this._preloadNestedWritableRelationships(model, permit);
        return model;
    }
    /**
     * Assigns attributes to a model, using virtual setters on the resource when available.
     * @param {import("../database/record/index.js").default} model - Model instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Attributes to assign.
     * @returns {Promise<void>}
     */
    async _assignWithVirtualSetters(model, attributes) {
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const directAttributes = {};
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        const translatedSet = new Set(ResourceClass.translatedAttributesConfig() || []);
        for (const [name, value] of Object.entries(attributes)) {
            const resourceSetterName = `set${inflection.camelize(name)}Attribute`;
            const resourceSetter = this.resourceMethod(resourceSetterName);
            if (resourceSetter) {
                await resourceSetter.method.call(resourceSetter.resource, model, value);
            }
            else if (translatedSet.has(name)) {
                await this._setTranslatedAttributeOnModel(model, name, value);
            }
            else {
                directAttributes[name] = value;
            }
        }
        if (Object.keys(directAttributes).length > 0) {
            model.assign(directAttributes);
        }
    }
    /**
     * Splits attachment-named attributes into the attachment payload while preserving legacy callers
     * that submitted attachments as normal frontend-model attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Incoming mutation attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} attachments - Explicit attachment payload.
     * @returns {{attributes: Record<string, ReturnType<typeof JSON.parse>>, attachments: Record<string, ReturnType<typeof JSON.parse>> | null}} Attributes with attachment keys removed and merged attachment payload.
     */
    _extractAttachmentAttributes(attributes, attachments) {
        const attachmentDefinitions = this.modelClass().attachmentDefinitions();
        const attachmentNames = new Set(Object.keys(attachmentDefinitions));
        if (attachmentNames.size === 0)
            return { attributes, attachments };
        if (attachments !== null && !isPlainObject(attachments)) {
            throw new Error("Expected attachments to be an object.");
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const regularAttributes = {};
        /** @type {Record<string, ReturnType<typeof JSON.parse>> | null} */
        let mergedAttachments = attachments ? { ...attachments } : null;
        for (const [attributeName, value] of Object.entries(attributes)) {
            if (!attachmentNames.has(attributeName)) {
                regularAttributes[attributeName] = value;
                continue;
            }
            if (!mergedAttachments)
                mergedAttachments = {};
            if (Object.prototype.hasOwnProperty.call(mergedAttachments, attributeName)) {
                throw new Error(`Attachment '${attributeName}' was submitted in both attributes and attachments.`);
            }
            mergedAttachments[attributeName] = value;
        }
        return { attributes: regularAttributes, attachments: mergedAttachments };
    }
    /**
     * Queues attachment payloads on a model after validating permits and attachment definitions.
     * @param {import("../database/record/index.js").default} model - Model receiving attachments.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} attachments - Attachments keyed by attachment name.
     * @param {string[]} permittedAttributeNames - Attribute/attachment names permitted by the resource.
     * @returns {void}
     */
    _assignAttachments(model, attachments, permittedAttributeNames) {
        if (!attachments)
            return;
        if (!isPlainObject(attachments))
            throw new Error("Expected attachments to be an object.");
        const permitSet = new Set(permittedAttributeNames);
        const modelClass = model.getModelClass();
        const attachmentDefinitions = modelClass.getAttachmentsMap();
        /** @type {string[]} */
        const notPermittedAttachments = [];
        /** @type {string[]} */
        const invalidAttachments = [];
        for (const [attachmentName, value] of Object.entries(attachments)) {
            if (!permitSet.has(attachmentName)) {
                notPermittedAttachments.push(attachmentName);
                continue;
            }
            if (!attachmentDefinitions[attachmentName]) {
                invalidAttachments.push(attachmentName);
                continue;
            }
            model.getAttachmentByName(attachmentName).queueAttach(value);
        }
        if (notPermittedAttachments.length > 0) {
            throw VelociousError.safe(`Frontend model attachment names not permitted by permittedParams(): ${notPermittedAttachments.join(", ")}`, { code: "frontend-model-attribute-error" });
        }
        if (invalidAttachments.length > 0) {
            throw VelociousError.safe(`Invalid frontend model attachment names: ${invalidAttachments.join(", ")}`, { code: "frontend-model-attribute-error" });
        }
    }
    /**
     * Sets a translated attribute on a model via the translations relationship.
     * @param {import("../database/record/index.js").default} model - Model instance.
     * @param {string} name - Attribute name.
     * @param {FrontendModelResourcePayloadValue} value - Attribute value.
     * @returns {Promise<void>}
     */
    async _setTranslatedAttributeOnModel(model, name, value) {
        const configuration = this.context?.configuration;
        const locale = configuration ? configuration.getLocale() : "en";
        const instanceRelationship = model.getRelationshipByName("translations");
        /** @type {import("../database/record/index.js").default | undefined} */
        let translation;
        if (model.isNewRecord()) {
            const loaded = instanceRelationship.loaded();
            if (Array.isArray(loaded)) {
                translation = loaded.find((t) => /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (t).locale() === locale);
            }
        }
        else {
            if (!instanceRelationship.getPreloaded()) {
                await model.loadRelationship("translations");
            }
            const loaded = instanceRelationship.loaded();
            if (Array.isArray(loaded)) {
                translation = loaded.find((t) => /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (t).locale() === locale);
            }
        }
        if (!translation) {
            translation = instanceRelationship.build({ locale });
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const assignments = {};
        assignments[name] = value;
        translation.assign(assignments);
    }
    /**
     * Runs destroy.
     * @param {import("../database/record/index.js").default} model - Existing model.
     * @returns {Promise<void>} - No return value.
     */
    async destroy(model) {
        await this.runMutationTransaction({
            action: "destroy",
            model,
            callback: async () => {
                await this.beforeDestroy(model);
                await model.destroy();
                await this.afterDestroy(model);
            }
        });
    }
    /**
     * Runs serialize.
     * @param {import("../database/record/index.js").default} model - Model to serialize.
     * @param {"index" | "find" | "create" | "update"} [action] - Action.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized model payload.
     */
    async serialize(model, action) {
        void action;
        return await this.typedControllerInstance().serializeFrontendModel(model);
    }
    /**
     * Resolves common metadata for one nested-attributes relationship.
     * @param {object} args - Nested relationship inputs.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {string} args.relationshipName - Relationship receiving nested attributes.
     * @param {FrontendModelResourcePayloadValue} args.rawEntries - Raw nested entries from the request payload.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}} args.childPermit - Parsed child permit.
     * @param {FrontendModelResourceController | null | undefined} args.controller - Controller instance for child resource lookup.
     * @returns {{ability: import("../authorization/ability.js").default | undefined, childPrimaryKey: import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition, childResource: FrontendModelBaseResource, childResourceConfig: FrontendModelResolvedResourceConfiguration, childWritableAttributes: string[], destroyPermitted: boolean, entries: Array<FrontendModelResourceNestedEntry>, relationship: import("../database/record/relationships/base.js").default, targetModelClass: typeof import("../database/record/index.js").default}} Nested relationship context.
     */
    _nestedRelationshipContext({ parent, relationshipName, rawEntries, childPermit, controller }) {
        if (!controller) {
            throw new Error(`Nested attributes for '${relationshipName}' require a controller instance.`);
        }
        const parentModelClass = parent.getModelClass();
        const modelAcceptance = parentModelClass.acceptedNestedAttributesFor(relationshipName);
        if (!modelAcceptance) {
            throw new Error(`Model ${parentModelClass.name} does not accept nested attributes for '${relationshipName}'. Declare it via ${parentModelClass.name}.acceptsNestedAttributesFor('${relationshipName}').`);
        }
        const relationship = parentModelClass.getRelationshipByName(relationshipName);
        const relationshipType = relationship.getType();
        const rawNormalizedEntries = this._nestedRelationshipEntries({ rawEntries, relationshipName, relationshipType });
        const destroyPermitted = childPermit.attributes.includes("_destroy");
        if (destroyPermitted && !modelAcceptance.allowDestroy) {
            throw new Error(`Resource permits _destroy on nestedAttributes['${relationshipName}'] but the model ${parentModelClass.name} does not allow destroy for that relationship. Set {allowDestroy: true} on ${parentModelClass.name}.acceptsNestedAttributesFor('${relationshipName}', ...).`);
        }
        if (typeof modelAcceptance.limit === "number" && rawNormalizedEntries.length > modelAcceptance.limit) {
            throw new Error(`nestedAttributes['${relationshipName}'] exceeds model-declared limit of ${modelAcceptance.limit}.`);
        }
        if (relationshipType !== "hasMany" && rawNormalizedEntries.length > 1) {
            throw new Error(`nestedAttributes['${relationshipName}'] accepts one entry for ${relationshipType} relationships.`);
        }
        const targetModelClass = relationship.getTargetModelClass();
        if (!targetModelClass) {
            throw new Error(`No target model class resolved for relationship '${relationshipName}' on ${parentModelClass.name}.`);
        }
        const childResourceConfig = controller.frontendModelResourceConfigurationForModelClass(targetModelClass);
        if (!childResourceConfig) {
            throw new Error(`No frontend-model resource registered for child model '${targetModelClass.getModelName()}' under relationship '${relationshipName}'.`);
        }
        const ChildResource = frontendModelResourceInternalConstructor(childResourceConfig.resourceClass);
        const childResource = new ChildResource({
            ability: this.ability,
            controller,
            context: this.context || {},
            locals: this.locals || {},
            modelClass: targetModelClass,
            modelName: childResourceConfig.modelName,
            params: controller.frontendModelParams(),
            resourceConfiguration: childResourceConfig.resourceConfiguration
        });
        const childPrimaryKey = childResource.primaryKey();
        const childWritableAttributes = childPermit.attributes.filter((name) => name !== "_destroy");
        const entries = rawNormalizedEntries
            .map((entry) => this._normalizeNestedRelationshipEntry({ childPermit, childPrimaryKey, entry, relationshipName, targetModelClass }))
            .filter((entry) => {
            if (typeof modelAcceptance.rejectIf !== "function")
                return true;
            return !modelAcceptance.rejectIf(isPlainObject(entry.attributes) ? entry.attributes : {});
        });
        return {
            ability: controller.currentAbility() || this.ability,
            childPrimaryKey,
            childResource,
            childResourceConfig,
            childWritableAttributes,
            destroyPermitted,
            entries,
            relationship,
            targetModelClass
        };
    }
    /**
     * Normalizes nested entries for collection and singular relationships.
     * @param {object} args - Nested entries inputs.
     * @param {FrontendModelResourcePayloadValue} args.rawEntries - Raw nested entries value.
     * @param {string} args.relationshipName - Relationship name.
     * @param {string} args.relationshipType - Relationship type.
     * @returns {Array<FrontendModelResourceNestedEntry>} Normalized nested entry objects.
     */
    _nestedRelationshipEntries({ rawEntries, relationshipName, relationshipType }) {
        if (relationshipType === "hasMany") {
            if (!Array.isArray(rawEntries)) {
                throw new Error(`Expected array for nestedAttributes['${relationshipName}'] but got: ${typeof rawEntries}`);
            }
            return rawEntries.map((entry) => {
                if (!isPlainObject(entry))
                    throw new Error(`nestedAttributes['${relationshipName}'] entries must be objects.`);
                // Narrows the plain-object payload to a normalized nested-entry object.
                return /** @type {FrontendModelResourceNestedEntry} */ (entry);
            });
        }
        if (rawEntries == null)
            return [];
        if (Array.isArray(rawEntries)) {
            return rawEntries.map((entry) => {
                if (!isPlainObject(entry))
                    throw new Error(`nestedAttributes['${relationshipName}'] entries must be objects.`);
                // Narrows the plain-object payload to a normalized nested-entry object.
                return /** @type {FrontendModelResourceNestedEntry} */ (entry);
            });
        }
        if (!isPlainObject(rawEntries)) {
            throw new Error(`Expected object for nestedAttributes['${relationshipName}'] but got: ${typeof rawEntries}`);
        }
        // Narrows the plain-object payload to a normalized nested-entry object.
        return [/** @type {FrontendModelResourceNestedEntry} */ (rawEntries)];
    }
    /**
     * Normalizes one nested entry from either internal transport shape
     * (`{attributes, attachments, nestedAttributes}`) or direct Rails-style
     * fields (`{name, file, commentsAttributes}`).
     * @param {object} args - Normalization inputs.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}} args.childPermit - Parsed child permit spec.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.childPrimaryKey - Resolved child resource primary key.
     * @param {FrontendModelResourceNestedEntry} args.entry - Raw nested entry.
     * @param {string} args.relationshipName - Relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {FrontendModelResourceNestedEntry} Normalized nested entry.
     */
    _normalizeNestedRelationshipEntry({ childPermit, childPrimaryKey, entry, relationshipName, targetModelClass }) {
        /** @type {FrontendModelResourceAttributePayload} */
        const attributes = {};
        /** @type {FrontendModelResourceAttributePayload} */
        const attachments = {};
        /** @type {FrontendModelResourceAttributePayload} */
        const nestedAttributes = {};
        /** @type {FrontendModelResourceNestedEntry} */
        const normalized = {};
        const attachmentDefinitions = targetModelClass.getAttachmentsMap();
        for (const [attributeName, value] of Object.entries(entry)) {
            if (attributeName === "id") {
                if (Array.isArray(childPrimaryKey)) {
                    modelPrimaryKeyConditions(childPrimaryKey, value);
                    normalized.id = /** @type {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} */ (value);
                }
                else {
                    if (typeof value !== "string" && typeof value !== "number") {
                        throw new Error(`nestedAttributes['${relationshipName}'] entry id must be a string or number.`);
                    }
                    normalized.id = value;
                }
                continue;
            }
            if (attributeName === "_destroy") {
                if (typeof value !== "boolean") {
                    throw new Error(`nestedAttributes['${relationshipName}'] entry _destroy must be a boolean.`);
                }
                normalized._destroy = value;
                continue;
            }
            if (attributeName === "attributes") {
                if (!isPlainObject(value))
                    throw new Error(`nestedAttributes['${relationshipName}'] entry attributes must be an object.`);
                Object.assign(attributes, value);
                continue;
            }
            if (attributeName === "attachments") {
                if (!isPlainObject(value))
                    throw new Error(`nestedAttributes['${relationshipName}'] entry attachments must be an object.`);
                Object.assign(attachments, value);
                continue;
            }
            if (attributeName === "nestedAttributes") {
                if (!isPlainObject(value))
                    throw new Error(`nestedAttributes['${relationshipName}'] entry nestedAttributes must be an object.`);
                Object.assign(nestedAttributes, value);
                continue;
            }
            if (attributeName.endsWith("Attributes")) {
                const nestedRelationshipName = attributeName.slice(0, -"Attributes".length);
                if (!nestedRelationshipName)
                    throw new Error(`Invalid nested attributes key: ${attributeName}`);
                if (!childPermit.nested[nestedRelationshipName]) {
                    throw new Error(`Nested attributes for '${nestedRelationshipName}' are not permitted under '${relationshipName}'. Include {${attributeName}: [...]} in that nested permit.`);
                }
                nestedAttributes[nestedRelationshipName] = value;
                continue;
            }
            if (attachmentDefinitions[attributeName]) {
                attachments[attributeName] = value;
            }
            else {
                attributes[attributeName] = value;
            }
        }
        if (Object.keys(attributes).length > 0)
            normalized.attributes = attributes;
        if (Object.keys(attachments).length > 0)
            normalized.attachments = attachments;
        if (Object.keys(nestedAttributes).length > 0)
            normalized.nestedAttributes = nestedAttributes;
        return normalized;
    }
    /**
     * Applies belongs-to nested attributes before the parent save so the parent FK can be set.
     * @param {import("../database/record/index.js").default} parent - Parent model instance.
     * @param {FrontendModelResourceAttributePayload} nestedAttributes - Nested-attribute payload keyed by relationship name.
     * @param {FrontendModelResourceController | null | undefined} controller - Controller instance for resource resolution and authorization.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>} | null} [parentPermit] - Parsed parent permit spec.
     * @returns {Promise<void>}
     */
    async _applyBelongsToNestedAttributes(parent, nestedAttributes, controller, parentPermit = null) {
        const resolvedParent = parentPermit
            || parsePermittedParams(this.permittedParams({ action: "update", ability: this.ability, locals: this.locals, params: {} }));
        for (const relationshipName of Object.keys(nestedAttributes)) {
            const childPermit = resolvedParent.nested[relationshipName];
            if (!childPermit)
                continue;
            const context = this._nestedRelationshipContext({
                childPermit,
                controller,
                parent,
                rawEntries: nestedAttributes[relationshipName],
                relationshipName
            });
            if (context.relationship.getType() !== "belongsTo")
                continue;
            const foreignKey = this._foreignKeyAttributeForModel(context.relationship, parent.getModelClass());
            for (const entry of context.entries) {
                if (entry._destroy) {
                    if (!context.destroyPermitted) {
                        throw new Error(`nestedAttributes['${relationshipName}'] entry requested _destroy but "_destroy" is not in the permit for this relationship.`);
                    }
                    const id = entry.id;
                    if (id == undefined)
                        throw new Error(`nestedAttributes['${relationshipName}'] _destroy entry is missing an id.`);
                    const existing = await this._findNestedRecord({
                        ability: context.ability,
                        action: "destroy",
                        childPrimaryKey: context.childPrimaryKey,
                        childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
                        id,
                        relationshipName,
                        targetModelClass: context.targetModelClass
                    });
                    await context.childResource.destroy(existing);
                    parent.setAttribute(foreignKey, null);
                    continue;
                }
                const id = entry.id;
                const child = id != undefined
                    ? await this._findNestedRecord({
                        ability: context.ability,
                        action: "update",
                        childPrimaryKey: context.childPrimaryKey,
                        childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
                        id,
                        relationshipName,
                        targetModelClass: context.targetModelClass
                    })
                    : new context.targetModelClass();
                await context.childResource._assignNestedEntryToChild({
                    child,
                    childWritableAttributes: context.childWritableAttributes,
                    entry
                });
                await context.childResource._applyBelongsToNestedAttributes(child, entry.nestedAttributes || {}, controller, childPermit);
                await child.save();
                if (id == undefined) {
                    await this._authorizeCreatedChild({
                        ability: context.ability,
                        child,
                        childPrimaryKey: context.childPrimaryKey,
                        childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
                        relationshipName,
                        targetModelClass: context.targetModelClass
                    });
                }
                if (entry.nestedAttributes) {
                    await context.childResource._applyNestedAttributes(child, entry.nestedAttributes, controller, childPermit);
                }
                parent.setAttribute(foreignKey, scalarModelPrimaryKeyValue(child.id(), `Nested belongs-to write for ${child.getModelClass().name}`));
            }
        }
    }
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
    async _applyNestedAttributes(parent, nestedAttributes, controller, parentPermit = null) {
        const resolvedParent = parentPermit
            || parsePermittedParams(this.permittedParams({ action: "update", ability: this.ability, locals: this.locals, params: {} }));
        for (const relationshipName of Object.keys(nestedAttributes)) {
            const childPermit = resolvedParent.nested[relationshipName];
            if (!childPermit) {
                throw new Error(`Nested attributes for '${relationshipName}' are not permitted by ${this.constructor.name}.permittedParams(). Include {${relationshipName}Attributes: [...]} in the returned permit.`);
            }
            const context = this._nestedRelationshipContext({
                childPermit,
                controller,
                parent,
                rawEntries: nestedAttributes[relationshipName],
                relationshipName
            });
            if (context.relationship.getType() === "belongsTo")
                continue;
            const parentLinkAttributes = this._parentLinkAttributesForNestedChild({
                parent,
                relationship: context.relationship,
                targetModelClass: context.targetModelClass
            });
            const destroyEntries = [];
            const updateEntries = [];
            const createEntries = [];
            for (const entry of context.entries) {
                if (entry?._destroy) {
                    if (!context.destroyPermitted) {
                        throw new Error(`nestedAttributes['${relationshipName}'] entry requested _destroy but "_destroy" is not in the permit for this relationship.`);
                    }
                    if (!entry.id) {
                        throw new Error(`nestedAttributes['${relationshipName}'] _destroy entry is missing an id.`);
                    }
                    destroyEntries.push(entry);
                }
                else if (entry?.id) {
                    updateEntries.push(entry);
                }
                else {
                    createEntries.push(entry);
                }
            }
            for (const entry of destroyEntries) {
                const id = entry.id;
                if (id == undefined) {
                    throw new Error(`nestedAttributes['${relationshipName}'] _destroy entry is missing an id.`);
                }
                const existing = await this._findScopedChild({
                    ability: context.ability,
                    action: "destroy",
                    childPrimaryKey: context.childPrimaryKey,
                    childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
                    id,
                    parent,
                    parentLinkAttributes,
                    relationshipName,
                    targetModelClass: context.targetModelClass
                });
                await context.childResource.destroy(existing);
            }
            for (const entry of updateEntries) {
                const id = entry.id;
                if (id == undefined) {
                    throw new Error(`nestedAttributes['${relationshipName}'] update entry is missing an id.`);
                }
                const existing = await this._findScopedChild({
                    ability: context.ability,
                    action: "update",
                    childPrimaryKey: context.childPrimaryKey,
                    childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
                    id,
                    parent,
                    parentLinkAttributes,
                    relationshipName,
                    targetModelClass: context.targetModelClass
                });
                await context.childResource._assignNestedEntryToChild({
                    child: existing,
                    childWritableAttributes: context.childWritableAttributes,
                    entry
                });
                await context.childResource._applyBelongsToNestedAttributes(existing, entry.nestedAttributes || {}, controller, childPermit);
                await existing.save();
                if (entry.nestedAttributes) {
                    await context.childResource._applyNestedAttributes(existing, entry.nestedAttributes, controller, childPermit);
                }
            }
            for (const entry of createEntries) {
                const child = new context.targetModelClass();
                child.assign(parentLinkAttributes);
                await context.childResource._assignNestedEntryToChild({
                    child,
                    childWritableAttributes: context.childWritableAttributes,
                    entry
                });
                await context.childResource._applyBelongsToNestedAttributes(child, entry.nestedAttributes || {}, controller, childPermit);
                await child.save();
                await this._authorizeCreatedChild({
                    ability: context.ability,
                    child,
                    childPrimaryKey: context.childPrimaryKey,
                    childResourceConfiguration: context.childResourceConfig.resourceConfiguration,
                    relationshipName,
                    targetModelClass: context.targetModelClass
                });
                if (entry.nestedAttributes) {
                    await context.childResource._applyNestedAttributes(child, entry.nestedAttributes, controller, childPermit);
                }
            }
        }
    }
    /**
     * Assigns one nested entry's attributes and attachments to a child model.
     * @param {object} args - Assignment inputs.
     * @param {import("../database/record/index.js").default} args.child - Child model receiving data.
     * @param {string[]} args.childWritableAttributes - Permitted child attribute and attachment names.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.entry - Nested entry payload.
     * @returns {Promise<void>}
     */
    async _assignNestedEntryToChild({ child, childWritableAttributes, entry }) {
        if (entry.attributes !== undefined) {
            if (!isPlainObject(entry.attributes))
                throw new Error("Expected nested entry attributes to be an object.");
            const filtered = filterWritableFrontendModelAttributes(child, child.getModelClass(), entry.attributes, this, childWritableAttributes);
            await this._assignWithVirtualSetters(child, filtered);
        }
        if (entry.attachments !== undefined && !isPlainObject(entry.attachments)) {
            throw new Error("Expected nested entry attachments to be an object.");
        }
        this._assignAttachments(child, entry.attachments ?? null, childWritableAttributes);
    }
    /**
     * Converts a relationship's foreign-key column/name to the target model's attribute name.
     * @param {import("../database/record/relationships/base.js").default} relationship - Relationship metadata.
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class containing the FK.
     * @returns {string} Foreign-key attribute name.
     */
    _foreignKeyAttributeForModel(relationship, modelClass) {
        const foreignKey = relationship.getForeignKey();
        return modelClass.getColumnNameToAttributeNameMap()[foreignKey] || foreignKey;
    }
    /**
     * Returns the FK attributes that bind a nested child to its parent.
     * @param {object} args - Parent-link inputs.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {import("../database/record/relationships/base.js").default} args.relationship - Relationship metadata.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Record<string, string | number>} Attributes that scope the child to the parent.
     */
    _parentLinkAttributesForNestedChild({ parent, relationship, targetModelClass }) {
        const foreignKey = this._foreignKeyAttributeForModel(relationship, targetModelClass);
        /** @type {Record<string, string | number>} */
        const attributes = { [foreignKey]: scalarModelPrimaryKeyValue(parent.id(), `Nested child write for ${parent.getModelClass().name}`) };
        if (relationship.getPolymorphic()) {
            const typeAttribute = this._polymorphicTypeAttributeForModel(relationship, targetModelClass);
            attributes[typeAttribute] = parent.getModelClass().getModelName();
        }
        return attributes;
    }
    /**
     * Converts a relationship's polymorphic type column/name to a child attribute name.
     * @param {import("../database/record/relationships/base.js").default} relationship - Relationship metadata.
     * @param {typeof import("../database/record/index.js").default} modelClass - Model class containing the type column.
     * @returns {string} Polymorphic type attribute name.
     */
    _polymorphicTypeAttributeForModel(relationship, modelClass) {
        const typeColumn = relationship.getPolymorphicTypeColumn();
        return modelClass.getColumnNameToAttributeNameMap()[typeColumn] || typeColumn;
    }
    /**
     * Finds an authorized nested record by id without parent scoping.
     * @param {object} args - Lookup inputs.
     * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
     * @param {"update" | "destroy"} args.action - Frontend action.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.childPrimaryKey - Resolved child resource primary key.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Child id from the payload.
     * @param {string} args.relationshipName - Parent's relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} Authorized child model.
     */
    async _findNestedRecord({ ability, action, childPrimaryKey, childResourceConfiguration, id, relationshipName, targetModelClass }) {
        const query = ability
            ? targetModelClass.accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
            : targetModelClass.where({});
        const existing = await query.findBy(modelPrimaryKeyConditions(childPrimaryKey, id));
        if (!existing) {
            throw new Error(`Cannot ${action} nested ${relationshipName}[id=${id}]: record not found or not authorized.`);
        }
        return existing;
    }
    /**
     * Resolves the ability action for a child resource using the child's own
     * `abilities` mapping — never the parent controller's. This preserves
     * custom mappings like `{update: "manage"}` and catches unmapped actions
     * instead of silently defaulting to the raw action name.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} childResourceConfiguration - Child resource configuration.
     * @param {"create" | "update" | "destroy"} action - Frontend action.
     * @returns {string} - Ability action for the child resource.
     */
    _resolveChildAbilityAction(childResourceConfiguration, action) {
        const abilities = childResourceConfiguration?.abilities;
        if (!abilities || typeof abilities !== "object" || Array.isArray(abilities)) {
            throw new Error(`Nested child resource must define an 'abilities' object to authorize nested ${action}.`);
        }
        const abilityAction = /** @type {Record<string, string>} */ (abilities)[action];
        if (typeof abilityAction !== "string" || abilityAction.length < 1) {
            throw new Error(`Nested child resource must define abilities.${action}.`);
        }
        return abilityAction;
    }
    /**
     * Finds an existing child for a nested update/destroy, scoped to the
     * child's own model class, the parent's foreign key, AND the child
     * resource's ability mapping for the requested action. Throws when the
     * child does not exist, does not belong to the current parent, or is
     * not authorized — all of which must roll the transaction back.
     * @param {object} args - Arguments.
     * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
     * @param {"update" | "destroy"} args.action - Frontend action.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.childPrimaryKey - Resolved child resource primary key.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Child id from the payload.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {Record<string, string | number>} args.parentLinkAttributes - Attributes that scope the child to the parent.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} - Authorized, parent-linked child model.
     */
    async _findScopedChild({ ability, action, childPrimaryKey, childResourceConfiguration, id, parent, parentLinkAttributes, relationshipName, targetModelClass }) {
        const identityConditions = modelPrimaryKeyConditions(childPrimaryKey, id);
        for (const [attributeName, parentValue] of Object.entries(parentLinkAttributes)) {
            if (Object.prototype.hasOwnProperty.call(identityConditions, attributeName) && identityConditions[attributeName] !== parentValue) {
                throw new Error(`Cannot ${action} nested ${relationshipName}[id=${id}]: identity field '${attributeName}' does not match parent ${parent.getModelClass().name}[id=${parent.id()}].`);
            }
        }
        const lookup = { ...identityConditions, ...parentLinkAttributes };
        const query = ability
            ? targetModelClass.accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
            : targetModelClass.where({});
        const existing = await query.findBy(lookup);
        if (!existing) {
            throw new Error(`Cannot ${action} nested ${relationshipName}[id=${id}]: record not found, does not belong to parent ${parent.getModelClass().name}[id=${parent.id()}], or is not authorized.`);
        }
        return existing;
    }
    /**
     * Verifies an already-saved nested child is authorized under the child
     * resource's own `create` ability. Rolls back via thrown error when not
     * authorized so the outer transaction destroys the insert.
     * @param {object} args - Arguments.
     * @param {import("../authorization/ability.js").default | undefined} args.ability - Current ability.
     * @param {import("../database/record/index.js").default} args.child - Child model instance just created.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.childPrimaryKey - Resolved child resource primary key.
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<void>}
     */
    async _authorizeCreatedChild({ ability, child, childPrimaryKey, childResourceConfiguration, relationshipName, targetModelClass }) {
        if (!ability)
            return;
        const abilityAction = this._resolveChildAbilityAction(childResourceConfiguration, "create");
        const identity = readModelPrimaryKeyValue(childPrimaryKey, (attributeName) => child.readAttribute(attributeName));
        const authorizedChild = await targetModelClass
            .accessibleFor(abilityAction, ability)
            .findBy(modelPrimaryKeyConditions(childPrimaryKey, identity));
        if (!authorizedChild) {
            throw new Error(`Nested create on ${relationshipName}[${targetModelClass.name}] not authorized.`);
        }
    }
    /**
     * After nested writes, preload every relationship declared in the
     * parent's permit so the post-save serialize step emits them and the
     * client can reconcile ids.
     * @param {import("../database/record/index.js").default} model - Saved parent model.
     * @param {{attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}} permit - Parsed parent permit.
     * @returns {Promise<void>}
     */
    async _preloadNestedWritableRelationships(model, permit) {
        const relationshipNames = Object.keys(permit.nested);
        if (relationshipNames.length === 0)
            return;
        for (const relationshipName of relationshipNames) {
            await model.loadRelationship(relationshipName);
        }
    }
}
/**
 * Parses the Rails/api_maker-style flat permit spec returned from
 * `permittedParams(arg)` into a structured shape used internally by the
 * write pipeline. Strings become attribute permits; objects whose keys
 * end in `Attributes` become nested permits (the key prefix names the
 * relationship).
 *
 *   parsePermittedParams(["firstName", "lastName",
 *     {tasksAttributes: ["id", "_destroy", "name"]}
 *   ])
 *   // → {
 *   //   attributes: ["firstName", "lastName"],
 *   //   nested: {
 *   //     tasks: {attributes: ["id", "_destroy", "name"], nested: {}}
 *   //   }
 *   // }
 * @param {Array<string | Record<string, ReturnType<typeof JSON.parse>>> | undefined} permitSpec - Flat permit spec.
 * @returns {{attributes: string[], nested: Record<string, {attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}>}} - Parsed structure.
 */
function parsePermittedParams(permitSpec) {
    /** @type {string[]} */
    const attributes = [];
    /** @type {Record<string, {attributes: string[], nested: Record<string, ReturnType<typeof JSON.parse>>}>} */
    const nested = {};
    if (!Array.isArray(permitSpec))
        return { attributes, nested };
    for (const entry of permitSpec) {
        if (typeof entry === "string") {
            attributes.push(entry);
        }
        else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            for (const [key, value] of Object.entries(entry)) {
                if (!key.endsWith("Attributes")) {
                    throw new Error(`Invalid permittedParams entry: nested relationship keys must end in "Attributes" (got "${key}"). Use "${key}Attributes" instead.`);
                }
                const relationshipName = key.slice(0, -"Attributes".length);
                if (!relationshipName) {
                    throw new Error(`Invalid permittedParams entry: empty relationship name in key "${key}".`);
                }
                if (!Array.isArray(value)) {
                    throw new Error(`Invalid permittedParams entry for "${key}": expected array permit spec, got ${typeof value}.`);
                }
                nested[relationshipName] = parsePermittedParams(value);
            }
        }
        else {
            throw new Error(`Invalid permittedParams entry: expected string or nested-attributes object, got ${typeof entry}.`);
        }
    }
    return { attributes, nested };
}
/**
 * Locates which prototype owns a method implementation.
 * @param {object} instance - Instance receiving the method.
 * @param {string} methodName - Method name.
 * @returns {object | null} - Prototype that owns the method.
 */
function prototypeOwnerForMethod(instance, methodName) {
    let prototype = Object.getPrototypeOf(instance);
    while (prototype) {
        if (Object.prototype.hasOwnProperty.call(prototype, methodName))
            return prototype;
        prototype = Object.getPrototypeOf(prototype);
    }
    return null;
}
/**
 * Runs filter writable frontend model attributes.
 * @template {FrontendModelResourceModelClass} ResourceModelClass
 * @template {typeof import("../database/record/index.js").default} ResourceDatabaseModelClass
 * @param {Record<string, ReturnType<typeof JSON.parse>>} receiver - Model instance or prototype.
 * @param {WritableAttributeReceiverClass} receiverClass - Static helper owner for the receiver.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Incoming frontend-model attributes.
 * @param {FrontendModelBaseResource<ResourceModelClass, ResourceDatabaseModelClass> | null} [resource] - Resource instance for virtual-setter detection.
 * @param {string[] | null} [permittedAttributeNames] - Optional explicit permit list. `null` falls back to setter-existence checks only.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Writable attributes only.
 */
function filterWritableFrontendModelAttributes(receiver, receiverClass, attributes, resource = /** @type {FrontendModelBaseResource<ResourceModelClass, ResourceDatabaseModelClass> | null} */ (null), permittedAttributeNames = null) {
    // Frontend-model writes should fail fast when callers submit read-only or unknown attrs.
    // Silent drops hide contract mistakes in generated models and app-side wrapper code.
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const writableAttributes = {};
    /** @type {string[]} */
    const invalidAttributes = [];
    /** @type {string[]} */
    const notPermittedAttributes = [];
    const permitSet = Array.isArray(permittedAttributeNames) ? new Set(permittedAttributeNames) : null;
    /** @type {string[]} */
    let translatedAttributes = [];
    if (resource) {
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (resource.constructor);
        translatedAttributes = ResourceClass.translatedAttributesConfig() || [];
    }
    const translatedSet = new Set(translatedAttributes);
    for (const [attributeName, value] of Object.entries(attributes)) {
        if (permitSet && !permitSet.has(attributeName)) {
            notPermittedAttributes.push(attributeName);
            continue;
        }
        const resolvedAttributeName = receiverClass.resolveAttributeName(attributeName) || attributeName;
        const requestedSetterName = `set${inflection.camelize(resolvedAttributeName)}`;
        const setterName = receiverClass.findMemberNameInsensitive(receiver, requestedSetterName) || requestedSetterName;
        const resourceSetterName = `set${inflection.camelize(attributeName)}Attribute`;
        const resourceSetter = resource?.resourceMethod(resourceSetterName);
        if (setterName in receiver) {
            writableAttributes[attributeName] = value;
        }
        else if (resourceSetter) {
            writableAttributes[attributeName] = value;
        }
        else if (translatedSet.has(attributeName)) {
            writableAttributes[attributeName] = value;
        }
        else {
            invalidAttributes.push(attributeName);
        }
    }
    if (notPermittedAttributes.length > 0) {
        throw VelociousError.safe(`Frontend model write attributes not permitted by permittedParams(): ${notPermittedAttributes.join(", ")}`, { code: "frontend-model-attribute-error" });
    }
    if (invalidAttributes.length > 0) {
        throw VelociousError.safe(`Invalid frontend model write attributes: ${invalidAttributes.join(", ")}`, { code: "frontend-model-attribute-error" });
    }
    return writableAttributes;
}
/**
 * Parses a trimmed quick-search value as a safe non-negative integer.
 * @param {string} searchValue - Trimmed quick-search value.
 * @returns {number | null} - Numeric search value, or null when not numeric.
 */
function quickSearchNumericValue(searchValue) {
    if (!/^[0-9]+$/u.test(searchValue))
        return null;
    const numericValue = Number.parseInt(searchValue, 10);
    return Number.isSafeInteger(numericValue) ? numericValue : null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sRUFBQyx5QkFBeUIsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQzdILE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7O0dBSUc7QUFFSDs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7OztHQVNHO0FBRUg7Ozs7Ozs7Ozs7OztHQVlHO0FBRUg7Ozs7OztHQU1HO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7O0dBS0c7QUFFSDs7O0dBR0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBQ0gsTUFBTSxVQUFVLHdDQUF3QyxDQUFDLGFBQWE7SUFDcEUsT0FBTyxtS0FBbUssQ0FBQyxFQUFDLHNCQUF1QixDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUE7QUFDck4sQ0FBQztBQUVELE1BQU0sbUJBQW1CLEdBQUcsYUFBYSxDQUFBO0FBR3pDOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUEwQixT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YUFBYSxDQUFDLENBQUE7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN0QyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsdUVBQXVFLHNCQUFzQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtJQUNqTCxDQUFDO0lBRUQsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakMsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLDRDQUE0QyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFDLElBQUksRUFBRSxnQ0FBZ0MsRUFBQyxDQUFDLENBQUE7SUFDakosQ0FBQztJQUVELE9BQU8sa0JBQWtCLENBQUE7QUFDM0IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHVCQUF1QixDQUFDLFdBQVc7SUFDMUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUE7SUFFL0MsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFFckQsT0FBTyxNQUFNLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtBQUNqRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBCYWNrZW5kIG9yIGZyb250ZW5kIG1vZGVsIGNsYXNzIGJvdW5kIHRvIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCIpLkF1dGhvcml6YXRpb25SZXNvdXJjZU1vZGVsQ2xhc3MgJiB7YXR0YWNobWVudERlZmluaXRpb25zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4sIHByaW1hcnlLZXk6ICgpID0+IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzXG4gKi9cblxuLyoqXG4gKiBCdWlsdC1pbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBhY3Rpb24uXG4gKiBAdHlwZWRlZiB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvblxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYW4gYXV0aG9yaXplZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF1dGhvcml6ZWRRdWVyeU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBbcnVsZVF1ZXJ5RmFjdG9yeV0gLSBRdWVyeSBmYWN0b3J5IHVzZWQgd2hlbiBhdXRob3JpemF0aW9uIG11c3QgdGFyZ2V0IGEgY2FwdHVyZWQgcmVjb3JkIHNuYXBzaG90LlxuICovXG5cbi8qKlxuICogRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBtZXRob2RzIHVzZWQgYnkgcmVzb3VyY2VzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdCAmIHtcbiAqICAgY3VycmVudEFiaWxpdHk6ICgpID0+IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uOiAoYXJnczoge3BhZ2luYXRpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24sIHF1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTZWFyY2g6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc2VhcmNoOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTb3J0OiAoYXJnczoge3F1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sIHNvcnQ6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9KSA9PiB2b2lkLFxuICogICBlbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGg6IChhcmdzOiB7cGF0aDogc3RyaW5nW10sIHF1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59KSA9PiB2b2lkLFxuICogICBmcm9udGVuZE1vZGVsQWJpbGl0eUFjdGlvbjogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBzdHJpbmcsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24sIG9wdGlvbnM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdXRob3JpemVkUXVlcnlPcHRpb25zKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnk6IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbiwgb3B0aW9ucz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF1dGhvcml6ZWRRdWVyeU9wdGlvbnMpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEluZGV4UXVlcnk6IChvcHRpb25zPzogRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnMgJiB7cmVzb3VyY2U/OiBQaWNrPEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4sIFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydFwiPn0pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbFBhcmFtczogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMsXG4gKiAgIGZyb250ZW5kTW9kZWxQcmVsb2FkOiAoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbCxcbiAqICAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3M6IChtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGwsXG4gKiAgIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWw6IChtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgb2JqZWN0IHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+PlxuICogfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlclxuICovXG5cbi8qKlxuICogR2VuZXJpYyBmcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeSBwYXNzZWQgdG8gcmVzb3VyY2UgcXVlcnkgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBpbmRleCBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyB0eXBlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPXR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGNvbnRyb2xsZXIgLSBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGluc3RhbmNlLlxuICogQHByb3BlcnR5IHtURGF0YWJhc2VNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbiAob3IgcmF3IGlucHV0IHNoYXBlIGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3MgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gW1RNb2RlbENsYXNzPUZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3NdXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnc1xuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZSB3aGVuIHRoZSByZXNvdXJjZSBpcyB1c2VkIGRpcmVjdGx5IGZvciBhdXRob3JpemF0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyLWxlc3MgY29uc3RydWN0aW9uIChmb3IgZXhhbXBsZSB0aGUgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCk7IHRoZSBjb250cm9sbGVyIHBhdGggZGVyaXZlcyBpdCBmcm9tIHRoZSBjb250cm9sbGVyIGluc3RlYWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtjb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2xvY2Fsc10gLSBBYmlsaXR5IGxvY2Fscy5cbiAqIEBwcm9wZXJ0eSB7VE1vZGVsQ2xhc3N9IFttb2RlbENsYXNzXSAtIE9wdGlvbmFsIGJhY2tpbmcgbW9kZWwgY2xhc3Mgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW21vZGVsTmFtZV0gLSBPcHRpb25hbCBtb2RlbCBuYW1lIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gW3BhcmFtc10gLSBPcHRpb25hbCBwYXJhbXMgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IFtyZXNvdXJjZUNvbmZpZ3VyYXRpb25dIC0gT3B0aW9uYWwgbm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogSW50ZXJuYWwgY29uc3RydWN0b3IgY29udHJhY3QgdXNlZCB3aGVuIGEgcmVzb3VyY2UgaW5zdGFudGlhdGVzIGl0cyBzaGFyZWRcbiAqIGNvdW50ZXJwYXJ0IGFjcm9zcyB0aGUgZnJvbnRlbmQvYmFja2VuZCBtb2RlbCBib3VuZGFyeS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gVE1vZGVsQ2xhc3NcbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBURGF0YWJhc2VNb2RlbENsYXNzXG4gKiBAdHlwZWRlZiB7e25ldyAoYXJnczogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3M8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4gfCBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyk6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fX0gRnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvclxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBwYXNzZWQgdG8gdGhlIHJlc291cmNlIHN5bmMgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vc3luYy9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gRnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvblxuICovXG5cbi8qKlxuICogU3luYyBtdXRhdGlvbiBhdXRob3JpemF0aW9uIHJlc3VsdC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvblxuICogQHByb3BlcnR5IHtib29sZWFufSBhbGxvd2VkIC0gV2hldGhlciB0aGUgbXV0YXRpb24gbWF5IGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3JlYXNvbl0gLSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSB3aGVuIGRlbmllZC5cbiAqL1xuXG4vKipcbiAqIEFyZ3VtZW50cyBmb3IgdGhlIGFwcGx5U3luYyBmdWxsLWVzY2FwZS1oYXRjaCBob29rLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3NcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gZXhpc3RpbmdTeW5jIC0gRXhpc3Rpbmcgc3luYyByb3cgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAqL1xuXG4vKipcbiAqIEFwcGx5IHJlc3VsdCBwcm9kdWNlZCBieSByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY3JlYXRlZCAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGNyZWF0ZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWxldGVkXSAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGRlbGV0ZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gcmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAqL1xuXG4vKipcbiAqIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdHJhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3Qgb3duaW5nIHRoZSByZXNvdXJjZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gcmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cblxuLyoqXG4gKiBUcmFuc3BvcnQtc2FmZSB2YWx1ZSBhY2NlcHRlZCBpbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbiBwYXlsb2Fkcy5cbiAqIE5lc3RlZCBvYmplY3QvYXJyYXkgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0c1xuICogcmVjdXJzaXZlIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCBwYXlsb2FkIGNvbnRyYWN0LlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlXG4gKi9cblxuLyoqXG4gKiBBdHRyaWJ1dGUgcGF5bG9hZCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbnMuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZFxuICovXG5cbi8qKlxuICogVmlydHVhbCBzZXR0ZXIgbWV0aG9kIG9uIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7KGFyZzE6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBhcmcyOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWUpID0+ICh2b2lkIHwgUHJvbWlzZTx2b2lkPil9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVZpcnR1YWxTZXR0ZXJcbiAqL1xuXG4vKipcbiAqIFN0YXRpYyBoZWxwZXJzIHVzZWQgd2hlbiBjaGVja2luZyB3aGV0aGVyIGEgbW9kZWwtbGlrZSByZWNlaXZlciBhY2NlcHRzIGFuIGF0dHJpYnV0ZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc1xuICogQHByb3BlcnR5IHsoYXJnOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IHJlc29sdmVBdHRyaWJ1dGVOYW1lIC0gUmVzb2x2ZXMgYWxpYXNlcyB0byBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWVzLlxuICogQHByb3BlcnR5IHsoYXJnMTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhcmcyOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUgLSBMb2NhdGVzIGEgc2V0dGVyIG1ldGhvZCBvbiB0aGUgcmVjZWl2ZXIuXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIHBhc3NlZCB3aGlsZSBzYXZpbmcgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFthdHRhY2htZW50c10gLSBVcGxvYWRlZCBhdHRhY2htZW50IGF0dHJpYnV0ZXMuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsfSBbY29udHJvbGxlcl0gLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBtdXRhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFtuZXN0ZWRBdHRyaWJ1dGVzXSAtIE5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cblxuLyoqXG4gKiBOb3JtYWxpemVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgJiB7aWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgX2Rlc3Ryb3k/OiBib29sZWFuLCBhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCwgYXR0YWNobWVudHM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBuZXN0ZWRBdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH19IEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5XG4gKi9cblxuLyoqXG4gKiBOYXJyb3dzIGFuIHVuYm91bmQgcmVzb3VyY2UgcmVnaXN0cnkgZW50cnkgYXQgZnJhbWV3b3JrLW93bmVkIGNvbnN0cnVjdGlvblxuICogc2l0ZXMgd2hlcmUgdGhlIGJhY2tpbmcgZGF0YWJhc2UgbW9kZWwgaGFzIGFscmVhZHkgYmVlbiByZXNvbHZlZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBVbmJvdW5kIHJlc291cmNlIGNsYXNzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3I8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBSdW50aW1lIGNvbnN0cnVjdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcihSZXNvdXJjZUNsYXNzKSB7XG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3I8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoUmVzb3VyY2VDbGFzcykpXG59XG5cbmNvbnN0IFFVSUNLX1NFQVJDSF9DT0xVTU4gPSBcInF1aWNrU2VhcmNoXCJcblxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tlbmQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBbVE1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPUV4dHJhY3Q8VE1vZGVsQ2xhc3MsIHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD5dXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZXh0ZW5kcyBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHtcbiAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhYmlsaXRpZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRhY2htZW50cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbWVtYmVyQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHNlcnZlciA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luYyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgc3RhdGljIFNoYXJlZFJlc291cmNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlY2xhcmF0aXZlIHF1aWNrLXNlYXJjaCB0ZXh0IGNvbHVtbnMuIFdoZW4gZGVjbGFyZWQsIGFuIGluZGV4IHNlYXJjaCBvblxuICAgKiB0aGUgcHNldWRvLWNvbHVtbiBgcXVpY2tTZWFyY2hgIGV4cGFuZHMgdG8gYW4gT1Igb2YgTElLRSBjb25kaXRpb25zIG92ZXJcbiAgICogdGhlc2UgY29sdW1ucyBpbnN0ZWFkIG9mIGhpdHRpbmcgdGhlIGNvbnRyb2xsZXIgZGVmYXVsdC4gRWFjaCBlbnRyeSBpcyBhXG4gICAqIHJvb3QtdGFibGUgY29sdW1uIG5hbWUgb3IgYSBge3BhdGgsIGNvbHVtbn1gIHBhaXIgZm9yIGEgam9pbmVkXG4gICAqIHJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUXVpY2tTZWFyY2hDb2x1bW4gfCBzdHJpbmc+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHF1aWNrU2VhcmNoQ29sdW1ucyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEZWNsYXJhdGl2ZSBxdWljay1zZWFyY2ggbnVtZXJpYyBjb2x1bW5zLiBXaGVuIHRoZSB0cmltbWVkIHF1aWNrLXNlYXJjaFxuICAgKiB2YWx1ZSBpcyBhIHNhZmUgbm9uLW5lZ2F0aXZlIGludGVnZXIsIGVhY2ggZGVjbGFyZWQgY29sdW1uIGFsc28gZ2V0cyBhblxuICAgKiBleGFjdCBgPWAgY29uZGl0aW9uIE9SZWQgaW50byB0aGUgcXVpY2stc2VhcmNoIHByZWRpY2F0ZS4gU2FtZSBlbnRyeSBzaGFwZVxuICAgKiBhcyB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5xdWlja1NlYXJjaENvbHVtbnN9LlxuICAgKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUXVpY2tTZWFyY2hDb2x1bW4gfCBzdHJpbmc+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGVjbGFyYXRpdmUgd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0IChjYW1lbENhc2UgYXR0cmlidXRlIG5hbWVzKVxuICAgKiB1c2VkIGFzIHRoZSBkZWZhdWx0IHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlI3Blcm1pdHRlZFBhcmFtc30gYW5kXG4gICAqIGFzIHRoZSByb3V0ZWQgc3luYyByZXBsYXkgcGVybWl0LiBSZXNvbHZlZCB0aHJvdWdoIHRoZSBzaGFyZWQgcmVzb3VyY2VcbiAgICogbGlrZSB0aGUgb3RoZXIgc3RhdGljIHJlc291cmNlIGNvbmZpZzogYW4gdW5kZWNsYXJlZCBlbnZpcm9ubWVudCBsaXN0XG4gICAqIGZhbGxzIGJhY2sgdG8gdGhlIHNoYXJlZCByZXNvdXJjZSdzIGxpc3QsIHdoaWxlIGFuIGV4cGxpY2l0IGRlY2xhcmF0aW9uXG4gICAqIChpbmNsdWRpbmcgYG51bGxgKSB3aW5zLlxuICAgKiBAdHlwZSB7c3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgd3JpdGFibGVBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3M8VE1vZGVsQ2xhc3M+IHwgRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3M8VERhdGFiYXNlTW9kZWxDbGFzcz59IGFyZ3MgLSBSZXNvdXJjZSBhcmdzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIHN1cGVyKHtcbiAgICAgIGFiaWxpdHk6IFwiYWJpbGl0eVwiIGluIGFyZ3MgPyBhcmdzLmFiaWxpdHkgOiB1bmRlZmluZWQsXG4gICAgICBjb250ZXh0OiBcImNvbnRleHRcIiBpbiBhcmdzID8gYXJncy5jb250ZXh0IHx8IHt9IDoge30sXG4gICAgICBsb2NhbHM6IFwibG9jYWxzXCIgaW4gYXJncyA/IGFyZ3MubG9jYWxzIHx8IHt9IDoge31cbiAgICB9KVxuXG4gICAgLy8gTmFycm93cyB0aGUgc3ViY2xhc3Mgc3RhdGljIHNpZGUgdG8gdGhlIG1vZGVsIGNsYXNzIGNhcnJpZWQgYnkgdGhpcyByZXNvdXJjZSBnZW5lcmljLlxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlICYge01vZGVsQ2xhc3M6IFRNb2RlbENsYXNzIHwgdW5kZWZpbmVkLCBtb2RlbENsYXNzOiAoKSA9PiBUTW9kZWxDbGFzc319ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBcImNvbnRyb2xsZXJcIiBpbiBhcmdzID8gYXJncy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgdGhpcy5jb25maWd1cmF0aW9uVmFsdWUgPSBcImNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5jb25maWd1cmF0aW9uIDogdW5kZWZpbmVkXG4gICAgLy8gTmFycm93cyB0aGUgaW50ZXJuYWwgY29udHJvbGxlci9zaGFyZWQtcmVzb3VyY2UgY29uc3RydWN0aW9uIHBhdGggdG8gdGhlIHJlc291cmNlJ3MgZGVjbGFyZWQgbW9kZWwgZ2VuZXJpYy5cbiAgICB0aGlzLm1vZGVsQ2xhc3NWYWx1ZSA9IC8qKiBAdHlwZSB7VE1vZGVsQ2xhc3N9ICovIChcIm1vZGVsQ2xhc3NcIiBpbiBhcmdzID8gYXJncy5tb2RlbENsYXNzIDogUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkpXG4gICAgdGhpcy5tb2RlbE5hbWVWYWx1ZSA9IFwibW9kZWxOYW1lXCIgaW4gYXJncyA/IGFyZ3MubW9kZWxOYW1lIDogdGhpcy5tb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICB0aGlzLnBhcmFtc1ZhbHVlID0gXCJwYXJhbXNcIiBpbiBhcmdzID8gYXJncy5wYXJhbXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlID0gXCJyZXNvdXJjZUNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24gOiBkZWZhdWx0UmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25maWd1cmVkIHNoYXJlZCByZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNoYXJlZCByZXNvdXJjZSBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLlNoYXJlZFJlc291cmNlXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIHZhbHVlIGZyb20gdGhlIGVudmlyb25tZW50IHJlc291cmNlIGZpcnN0LFxuICAgKiB0aGVuIGZyb20gdGhlIHNoYXJlZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtcImFiaWxpdGllc1wiIHwgXCJhdHRhY2htZW50c1wiIHwgXCJhdHRyaWJ1dGVzXCIgfCBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIgfCBcImNvbGxlY3Rpb25Db21tYW5kc1wiIHwgXCJjb21tYW5kc1wiIHwgXCJtZW1iZXJDb21tYW5kc1wiIHwgXCJtb2RlbE5hbWVcIiB8IFwicHJpbWFyeUtleVwiIHwgXCJxdWlja1NlYXJjaENvbHVtbnNcIiB8IFwicXVpY2tTZWFyY2hOdW1lcmljQ29sdW1uc1wiIHwgXCJyZWxhdGlvbnNoaXBzXCIgfCBcInNlcnZlclwiIHwgXCJzeW5jXCIgfCBcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIgfCBcIndyaXRhYmxlQXR0cmlidXRlc1wifSBuYW1lIC0gU3RhdGljIGNvbmZpZyBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gUmVzb2x2ZWQgY29uZmlnIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUobmFtZSkge1xuICAgIGlmICh0aGlzW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzW25hbWVdXG5cbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlQ2xhc3MoKSlcblxuICAgIGlmICghU2hhcmVkUmVzb3VyY2UpIHJldHVybiB1bmRlZmluZWRcbiAgICBpZiAoU2hhcmVkUmVzb3VyY2VbbmFtZV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIFNoYXJlZFJlc291cmNlW25hbWVdXG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdHJhbnNsYXRlZCBhdHRyaWJ1dGVzIGZyb20gZW52aXJvbm1lbnQgYW5kIHNoYXJlZCByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gLSBUcmFuc2xhdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyB0cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGZyb250ZW5kLXNhZmUgYXR0YWNobWVudCBkZWNsYXJhdGlvbnMgZnJvbSB0aGUgYmFja2luZyBtb2RlbC5cbiAgICogUmVzb3VyY2UtbGV2ZWwgZGVjbGFyYXRpb25zIHJlbWFpbiBhcyBhIGZhbGxiYWNrIGZvciBmcm9udGVuZC1vbmx5IHJlc291cmNlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBDbGllbnQgYXR0YWNobWVudCBjb25maWd1cmF0aW9uIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudENvbmZpZ3VyYXRpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRhY2htZW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0YWNobWVudHNcIikpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBjb25maWd1cmVkQXR0YWNobWVudHMgPyB7Li4uY29uZmlndXJlZEF0dGFjaG1lbnRzfSA6IHt9XG5cbiAgICBpZiAoIXRoaXMuTW9kZWxDbGFzcykgcmV0dXJuIGF0dGFjaG1lbnRzXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgZGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5Nb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudENvbmZpZyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb259ICovICh7dHlwZTogZGVmaW5pdGlvbi50eXBlfSlcblxuICAgICAgaWYgKGRlZmluaXRpb24uc3luYykgYXR0YWNobWVudENvbmZpZy5zeW5jID0gey4uLmRlZmluaXRpb24uc3luY31cblxuICAgICAgYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudENvbmZpZ1xuICAgIH1cblxuICAgIHJldHVybiBhdHRhY2htZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJlc291cmNlIGluc3RhbmNlIGZvciBzaGFyZWQtcmVzb3VyY2UgZmFsbGJhY2sgY2FsbHMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9IC0gU2hhcmVkIHJlc291cmNlIGluc3RhbmNlIHdoZW4gY29uZmlndXJlZC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlSW5zdGFuY2UoKSB7XG4gICAgaWYgKHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgdW5kZWZpbmVkfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSB7XG4gICAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IG51bGxcbiAgICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuICAgIH1cblxuICAgIGlmIChTaGFyZWRSZXNvdXJjZSA9PT0gUmVzb3VyY2VDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke1Jlc291cmNlQ2xhc3MubmFtZX0uU2hhcmVkUmVzb3VyY2UgY2Fubm90IHBvaW50IHRvIGl0c2VsZi5gKVxuICAgIH1cblxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlQ29uc3RydWN0b3IgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3I8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoU2hhcmVkUmVzb3VyY2UpKVxuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gbmV3IFNoYXJlZFJlc291cmNlQ29uc3RydWN0b3Ioe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgY29udHJvbGxlcjogdGhpcy5jb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcygpLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLm1vZGVsTmFtZSgpLFxuICAgICAgcGFyYW1zOiB0aGlzLnBhcmFtcygpLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvbigpXG4gICAgfSlcbiAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IHNoYXJlZFJlc291cmNlXG5cbiAgICByZXR1cm4gc2hhcmVkUmVzb3VyY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxscyBhIHNoYXJlZC1yZXNvdXJjZSBtZXRob2Qgb25seSB3aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ugb3ZlcnJpZGVzIHRoZSBmcmFtZXdvcmsgZGVmYXVsdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIE1ldGhvZCBhcmdzLlxuICAgKiBAcmV0dXJucyB7e2NhbGxlZDogYm9vbGVhbiwgcmVzdWx0OiB1bmtub3dufX0gLSBTaGFyZWQgbWV0aG9kIGNhbGwgcmVzdWx0LlxuICAgKi9cbiAgY2FsbFNoYXJlZFJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoIXNoYXJlZFJlc291cmNlKSByZXR1cm4ge2NhbGxlZDogZmFsc2UsIHJlc3VsdDogdW5kZWZpbmVkfVxuXG4gICAgY29uc3QgbWV0aG9kT3duZXIgPSBwcm90b3R5cGVPd25lckZvck1ldGhvZChzaGFyZWRSZXNvdXJjZSwgbWV0aG9kTmFtZSlcblxuICAgIGlmICghbWV0aG9kT3duZXIgfHwgbWV0aG9kT3duZXIgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlIHx8IG1ldGhvZE93bmVyID09PSBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlLnByb3RvdHlwZSkge1xuICAgICAgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc2hhcmVkUmVzb3VyY2UpKVttZXRob2ROYW1lXVxuXG4gICAgcmV0dXJuIHtjYWxsZWQ6IHRydWUsIHJlc3VsdDogbWV0aG9kLmFwcGx5KHNoYXJlZFJlc291cmNlLCBhcmdzKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNoYXJlZCBtZXRob2QgcmVzdWx0IG9yIGEgZmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBTaGFyZWQgbWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7dW5rbm93bltdfSBhcmdzIC0gU2hhcmVkIG1ldGhvZCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFJlc3VsdH0gZmFsbGJhY2sgLSBGYWxsYmFjayBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Jlc3VsdH0gLSBTaGFyZWQgb3IgZmFsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgc2hhcmVkUmVzb3VyY2VNZXRob2RPcihtZXRob2ROYW1lLCBhcmdzLCBmYWxsYmFjaykge1xuICAgIGNvbnN0IHNoYXJlZFJlc3VsdCA9IHRoaXMuY2FsbFNoYXJlZFJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUsIGFyZ3MpXG5cbiAgICBpZiAoc2hhcmVkUmVzdWx0LmNhbGxlZCkgcmV0dXJuIC8qKiBAdHlwZSB7UmVzdWx0fSAqLyAoc2hhcmVkUmVzdWx0LnJlc3VsdClcblxuICAgIHJldHVybiBmYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBtZXRob2Qgb24gdGhpcyByZXNvdXJjZSBvciBpdHMgc2hhcmVkIGZhbGxiYWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e21ldGhvZDogKC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93biwgcmVzb3VyY2U6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSB8IG51bGx9IC0gUmVzb2x2ZWQgbWV0aG9kIGFuZCByZWNlaXZlci5cbiAgICovXG4gIHJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUpIHtcbiAgICBjb25zdCBvd25NZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIG93bk1ldGhvZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBtZXRob2Q6IC8qKiBAdHlwZSB7KC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bn0gKi8gKG93bk1ldGhvZCksXG4gICAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNoYXJlZE1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzaGFyZWRSZXNvdXJjZSkpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIHNoYXJlZE1ldGhvZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAoc2hhcmVkTWV0aG9kKSxcbiAgICAgIHJlc291cmNlOiBzaGFyZWRSZXNvdXJjZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFiaWxpdGllcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWJpbGl0aWVzKCkge1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFiaWxpdGllc1wiLCBbXSwgKCkgPT4gdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHlwZWQgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IC0gQ29udHJvbGxlciBpbnN0YW5jZSB3aXRoIGZyb250ZW5kLW1vZGVsIGhlbHBlcnMuXG4gICAqL1xuICB0eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAqLyAodGhpcy5jb250cm9sbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIFN0YXRpYyByZXNvdXJjZSBjb25maWcgKHJhdyB1c2VyIGlucHV0IHNoYXBlOyBjb25zdW1lcnMgbm9ybWFsaXplKS5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0cmlidXRlc1wiKVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImFiaWxpdGllc1wiKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gdGhpcy5hdHRhY2htZW50Q29uZmlndXJhdGlvbnMoKVxuICAgIGNvbnN0IGNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiY29tbWFuZHNcIilcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiKVxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiKVxuICAgIGNvbnN0IGNvbGxlY3Rpb25Db21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImNvbGxlY3Rpb25Db21tYW5kc1wiKVxuICAgIGNvbnN0IG1lbWJlckNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibWVtYmVyQ29tbWFuZHNcIilcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtb2RlbE5hbWVcIilcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwicHJpbWFyeUtleVwiKVxuICAgIGNvbnN0IHF1aWNrU2VhcmNoQ29sdW1ucyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInF1aWNrU2VhcmNoQ29sdW1uc1wiKVxuICAgIGNvbnN0IHF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJxdWlja1NlYXJjaE51bWVyaWNDb2x1bW5zXCIpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInJlbGF0aW9uc2hpcHNcIilcbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzZXJ2ZXJcIilcbiAgICBjb25zdCBzeW5jID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwic3luY1wiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqL1xuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW119ICovIChhdHRyaWJ1dGVzIHx8IFtdKVxuICAgIH1cblxuICAgIGlmIChhYmlsaXRpZXMpIGNvbmZpZy5hYmlsaXRpZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYWJpbGl0aWVzKVxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgY29uZmlnLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoY29tbWFuZHMpIGNvbmZpZy5jb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChjb21tYW5kcylcbiAgICBpZiAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcykgY29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKSBjb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGJ1aWx0SW5NZW1iZXJDb21tYW5kcylcbiAgICBpZiAoY29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuY29sbGVjdGlvbkNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAobWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5tZW1iZXJDb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChtZW1iZXJDb21tYW5kcylcbiAgICBpZiAobW9kZWxOYW1lKSBjb25maWcubW9kZWxOYW1lID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChtb2RlbE5hbWUpXG4gICAgaWYgKHByaW1hcnlLZXkpIGNvbmZpZy5wcmltYXJ5S2V5ID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBzdHJpbmdbXX0gKi8gKHByaW1hcnlLZXkpXG4gICAgaWYgKHF1aWNrU2VhcmNoQ29sdW1ucyAhPT0gdW5kZWZpbmVkKSBjb25maWcucXVpY2tTZWFyY2hDb2x1bW5zID0gLyoqIEB0eXBlIHtBcnJheTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxRdWlja1NlYXJjaENvbHVtbiB8IHN0cmluZz59ICovIChxdWlja1NlYXJjaENvbHVtbnMpXG4gICAgaWYgKHF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnMgIT09IHVuZGVmaW5lZCkgY29uZmlnLnF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnMgPSAvKiogQHR5cGUge0FycmF5PGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFF1aWNrU2VhcmNoQ29sdW1uIHwgc3RyaW5nPn0gKi8gKHF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnMpXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMpIGNvbmZpZy5yZWxhdGlvbnNoaXBzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKHJlbGF0aW9uc2hpcHMpXG4gICAgaWYgKHNlcnZlcikgY29uZmlnLnNlcnZlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTZXJ2ZXJDb25maWd1cmF0aW9ufSAqLyAoc2VydmVyKVxuICAgIGlmIChzeW5jICE9PSB1bmRlZmluZWQpIGNvbmZpZy5zeW5jID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgYm9vbGVhbn0gKi8gKHN5bmMpXG5cbiAgICByZXR1cm4gY29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGNsaWVudC1mYWNpbmcgcmVzb3VyY2UgcHJpbWFyeSBrZXkgZnJvbSBleHBsaWNpdCByZXNvdXJjZSBjb25maWcgb3IgdGhlIGJhY2tpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gQ2xpZW50LWZhY2luZyBwcmltYXJ5IGtleS5cbiAgICovXG4gIHN0YXRpYyByZXNvbHZlZFByaW1hcnlLZXkocmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgaWYgKHJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5KSByZXR1cm4gcmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXlcbiAgICBpZiAoIXRoaXMuTW9kZWxDbGFzcykgcmV0dXJuIFwiaWRcIlxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5tb2RlbENsYXNzKCkpXG4gICAgY29uc3QgbW9kZWxQcmltYXJ5S2V5ID0gbW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgIHJldHVybiBBcnJheS5pc0FycmF5KG1vZGVsUHJpbWFyeUtleSlcbiAgICAgID8gbW9kZWxQcmltYXJ5S2V5Lm1hcCgoY29sdW1uTmFtZSkgPT4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb2x1bW5OYW1lKSB8fCBjb2x1bW5OYW1lKVxuICAgICAgOiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG1vZGVsUHJpbWFyeUtleSkgfHwgbW9kZWxQcmltYXJ5S2V5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb250cm9sbGVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAtIENvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqL1xuICBjb250cm9sbGVySW5zdGFuY2UoKSB7XG4gICAgaWYgKCF0aGlzLmNvbnRyb2xsZXIpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgY29udHJvbGxlciBpbnN0YW5jZS5gKVxuXG4gICAgcmV0dXJuIHRoaXMuY29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIFZlbG9jaW91cyBjb25maWd1cmF0aW9uOiB0aGUgY29udHJvbGxlcidzIHdoZW4gdGhlIHJlc291cmNlXG4gICAqIHNlcnZlcyBhIGNvbnRyb2xsZXIgcmVxdWVzdCwgb3RoZXJ3aXNlIHRoZSBjb25zdHJ1Y3Rvci1pbmplY3RlZFxuICAgKiBjb25maWd1cmF0aW9uIChmb3IgZXhhbXBsZSBhIHN5bmMgd2Vic29ja2V0IGNoYW5uZWwncyByZXNvdXJjZSkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBjb25maWd1cmF0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRyb2xsZXIpIHJldHVybiB0aGlzLmNvbnRyb2xsZXJJbnN0YW5jZSgpLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGlmICh0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZSkgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvblZhbHVlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIGNvbnRyb2xsZXIgb3IgYW4gaW5qZWN0ZWQgY29uZmlndXJhdGlvbi5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gLSBNb2RlbCBjbGFzcy5cbiAgICovXG4gIG1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsQ2xhc3NWYWx1ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBtb2RlbCBjbGFzcy5gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3NWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRhdGFiYXNlIG1vZGVsIGNsYXNzIHVzZWQgYnkgc2VydmVyLW9ubHkgcmVzb3VyY2Ugb3BlcmF0aW9ucy5cbiAgICogQHJldHVybnMge1REYXRhYmFzZU1vZGVsQ2xhc3N9IC0gRGF0YWJhc2UgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBkYXRhYmFzZU1vZGVsQ2xhc3MoKSB7XG4gICAgLy8gTmFycm93cyB0aGUgcG9ydGFibGUgcmVzb3VyY2UgZ2VuZXJpYyBhdCB0aGUgZXhwbGljaXQgYmFja2VuZC1vcGVyYXRpb24gYm91bmRhcnkuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VERhdGFiYXNlTW9kZWxDbGFzc30gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMubW9kZWxDbGFzcygpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmVkIG1vZGVsIGNsYXNzIGZvciBhdXRob3JpemF0aW9uIGhlbHBlcnMuXG4gICAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgcmVxdWlyZWRNb2RlbENsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNb2RlbCBuYW1lLlxuICAgKi9cbiAgbW9kZWxOYW1lKCkge1xuICAgIGlmICghdGhpcy5tb2RlbE5hbWVWYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBtb2RlbCBuYW1lLmApXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbE5hbWVWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IC0gUGFyYW1zLlxuICAgKi9cbiAgcGFyYW1zKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gKi8gKHRoaXMucGFyYW1zVmFsdWUgfHwgc3VwZXIucGFyYW1zKCkgfHwge30pIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBSZXNvdXJjZSBjb25maWcgKG5vcm1hbGl6ZWQgYXQgcnVudGltZTsgcmF3IGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICAgKi9cbiAgcmVzb3VyY2VDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSByZXNvdXJjZSBjb25maWd1cmF0aW9uLmApXG5cbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBSYWlscy1zdHJvbmctcGFyYW1zIC8gYXBpX21ha2VyLXN0eWxlIHBlcm1pdCBzcGVjIGRlY2xhcmluZ1xuICAgKiB3aGljaCBhdHRyaWJ1dGVzIGFuZCBuZXN0ZWQgYXR0cmlidXRlcyBhcmUgd3JpdGFibGUgZm9yIHRoZSBjdXJyZW50XG4gICAqIHJlcXVlc3QuIFN1Ym1pdHRpbmcgYW4gYXR0cmlidXRlIG9yIG5lc3RlZC1yZWxhdGlvbnNoaXAga2V5IHRoYXQgaXNcbiAgICogbm90IHBlcm1pdHRlZCByYWlzZXMgYW4gZXJyb3IgYW5kIGZhaWxzIHRoZSB3cml0ZS5cbiAgICpcbiAgICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgZmxhdCBhcnJheSB0aGF0IG1peGVzOlxuICAgKiAgIC0gYFwiYXR0cmlidXRlTmFtZVwiYCBzdHJpbmdzIGZvciBwbGFpbiBhdHRyaWJ1dGUgd3JpdGVzXG4gICAqICAgLSBgezxyZWxhdGlvbnNoaXBOYW1lPkF0dHJpYnV0ZXM6IFsuLi5dfWAgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWVcbiAgICogICAgIGlzIGl0c2VsZiBhIHBlcm1pdCBzcGVjIGZvciB0aGUgbmVzdGVkIHJlbGF0aW9uc2hpcFxuICAgKlxuICAgKiBUaGlzIG1hdGNoZXMgUmFpbHMgc3Ryb25nX3BhcmFtcyAoYHBlcm1pdCg6Zmlyc3RfbmFtZSwgOmxhc3RfbmFtZSxcbiAgICogY29udGFjdF9hdHRyaWJ1dGVzOiBbOmVtYWlsLCBkZXRhaWxzX2F0dHJpYnV0ZXM6IFs6ZGV0YWlsXV0pYCkgYW5kXG4gICAqIHRoZSBhcGlfbWFrZXIgc2lzdGVyIHByb2plY3QuIEluY2x1ZGUgYFwiX2Rlc3Ryb3lcImAgaW5zaWRlIGEgbmVzdGVkXG4gICAqIHBlcm1pdCB0byBhbGxvdyBgX2Rlc3Ryb3k6IHRydWVgIGVudHJpZXMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlFxuICAgKiB0aGUgbW9kZWwgbXVzdCBhbHNvIGRlY2xhcmUgYGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUsXG4gICAqIHthbGxvd0Rlc3Ryb3k6IHRydWV9KWAgZm9yIHRoZSBkZXN0cm95IHRvIGJlIGFwcGxpZWQuXG4gICAqXG4gICAqIEV4YW1wbGU6XG4gICAqXG4gICAqICAgY2xhc3MgUHJvamVjdFJlc291cmNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gICAqICAgICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAqICAgICAgIHJldHVybiBbXG4gICAqICAgICAgICAgXCJuYW1lXCIsXG4gICAqICAgICAgICAgXCJkZXNjcmlwdGlvblwiLFxuICAgKiAgICAgICAgIHt0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCIsXG4gICAqICAgICAgICAgICB7c3VidGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAgICogICAgICAgICBdfVxuICAgKiAgICAgICBdXG4gICAqICAgICB9XG4gICAqICAgfVxuICAgKlxuICAgKiBEZWZhdWx0IGltcGxlbWVudGF0aW9uIHJldHVybnMgdGhlIGRlY2xhcmVkXG4gICAqIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLndyaXRhYmxlQXR0cmlidXRlc30gcGVybWl0IGxpc3QsIG9yIGBbXWBcbiAgICog4oCUIG5vdGhpbmcgcGVybWl0dGVkIOKAlCB3aXRob3V0IGEgZGVjbGFyZWQgbGlzdC4gU3ViY2xhc3NlcyBvdmVycmlkZSB0b1xuICAgKiBjdXN0b21pemU7IGFuIGV4cGxpY2l0IG92ZXJyaWRlIGFsd2F5cyB3aW5zLlxuICAgKiBAcGFyYW0ge3thY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhYmlsaXR5PzogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQsIGxvY2Fscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmddIC0gUmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQZXJtaXQgc3BlYy5cbiAgICovXG4gIHBlcm1pdHRlZFBhcmFtcyhhcmcpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwicGVybWl0dGVkUGFyYW1zXCIsIFthcmddLCAoKSA9PiB7XG4gICAgICB2b2lkIGFyZ1xuXG4gICAgICByZXR1cm4gdGhpcy5kZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpID8/IFtdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGVjbGFyZWQgd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0IGZyb20gdGhlIGVudmlyb25tZW50XG4gICAqIHJlc291cmNlIGZpcnN0LCB0aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ug4oCUIG1pcnJvcmluZyBob3cgdGhlIG90aGVyXG4gICAqIHN0YXRpYyByZXNvdXJjZSBjb25maWcgcmVzb2x2ZXMuIEFuIGV4cGxpY2l0IGVudmlyb25tZW50IGRlY2xhcmF0aW9uXG4gICAqIChpbmNsdWRpbmcgYG51bGxgKSB3aW5zIG92ZXIgdGhlIHNoYXJlZCByZXNvdXJjZSdzIGxpc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IERlY2xhcmVkIHBlcm1pdCBsaXN0IG9yIG51bGwgd2hlbiB1bmRlY2xhcmVkLlxuICAgKi9cbiAgZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHBlcm1pdHRlZEF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIndyaXRhYmxlQXR0cmlidXRlc1wiKSlcblxuICAgIHJldHVybiBwZXJtaXR0ZWRBdHRyaWJ1dGVzID8/IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNsaWVudC1zYWZlIGVycm9yIHRocm93biBmb3IgYSBmYWlsZWQgd3JpdGFibGUtYXR0cmlidXRlIHZhbGlkYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gSHVtYW4tcmVhZGFibGUgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tjYXVzZT86IEVycm9yLCBjb2RlOiBzdHJpbmd9fSBkZXRhaWxzIC0gU3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgY29kZSBhbmQgb3B0aW9uYWwgY2F1c2UuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gQ2xpZW50LXNhZmUgZXJyb3IuXG4gICAqL1xuICB3cml0YWJsZUF0dHJpYnV0ZUVycm9yKG1lc3NhZ2UsIHtjYXVzZSwgY29kZX0pIHtcbiAgICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShtZXNzYWdlLCBjYXVzZSA/IHtjYXVzZSwgY29kZX0gOiB7Y29kZX0pXG4gIH1cblxuICAvKipcbiAgICogQXV0aG9yaXplcyBvbmUgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIGJlZm9yZSBpdCBpcyBhcHBsaWVkLlxuICAgKiBEZWZhdWx0cyB0byBhbGxvd2luZyBldmVyeSBtdXRhdGlvbjsgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24gc3RpbGxcbiAgICogYXBwbGllcyB0aHJvdWdoIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlI2ZpbmRTeW5jUmVjb3JkfSBzY29waW5nXG4gICAqIGFuZCB0aGUgY3JlYXRlIG1lbWJlcnNoaXAgY2hlY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbiB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uPn0gQXV0aG9yaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhdXRob3JpemVTeW5jTXV0YXRpb24oe2NvbnRleHQsIG11dGF0aW9ufSkge1xuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgbXV0YXRpb25cblxuICAgIHJldHVybiB7YWxsb3dlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBwZXItc3luYyBmYWlsdXJlIHJlYXNvbiByZXBvcnRlZCB3aGVuIGEgcm91dGVkIHN5bmMgbXV0YXRpb25cbiAgICogZmFpbHMgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24uIERlZmF1bHRzIHRvIG51bGwsIHdoaWNoIHJlcG9ydHMgdGhlXG4gICAqIGdlbmVyaWMgXCJhY2Nlc3MtZGVuaWVkXCIgcmVhc29uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gYXJncy5hY3Rpb24gLSBEZW5pZWQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFN0YWJsZSBmYWlsdXJlIHJlYXNvbiBjb2RlIG9yIG51bGwgZm9yIHRoZSBnZW5lcmljIGRlZmF1bHQuXG4gICAqL1xuICBzeW5jQXV0aG9yaXphdGlvbkZhaWx1cmVSZWFzb24oe2FjdGlvbiwgbXV0YXRpb259KSB7XG4gICAgdm9pZCBhY3Rpb25cbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBleGlzdGluZyByZWNvcmQgdGFyZ2V0ZWQgYnkgYSByb3V0ZWQgc3luYyByZXBsYXkgbXV0YXRpb24uXG4gICAqIERlZmF1bHRzIHRvIGFuIGBhY2Nlc3NpYmxlRm9yYCBsb29rdXAgYnkgcHJpbWFyeSBrZXkgdGhyb3VnaCB0aGVcbiAgICogcmVzb3VyY2UncyBub3JtYWxpemVkIGFiaWxpdHkgYWN0aW9uIGZvciB1cGRhdGUgKG9yIGRlc3Ryb3kgZm9yIGRlbGV0ZVxuICAgKiBtdXRhdGlvbnMpLCBmYWxsaW5nIGJhY2sgdG8gYW4gdW5zY29wZWQgbG9va3VwIHdpdGhvdXQgYW4gYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYXJncy5hYmlsaXR5XSAtIEFiaWxpdHkgb3ZlcnJpZGUuIERlZmF1bHRzIHRvIHRoZSByZXNvdXJjZSBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmZvckRlbGV0ZV0gLSBXaGV0aGVyIHRoZSBsb29rdXAgaXMgZm9yIGEgZGVsZXRlIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gRXhpc3RpbmcgcmVjb3JkIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBmaW5kU3luY1JlY29yZCh7YWJpbGl0eSA9IHRoaXMuYWJpbGl0eSwgZm9yRGVsZXRlID0gZmFsc2UsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcXVlcnkgPSBhYmlsaXR5XG4gICAgICA/IE1vZGVsQ2xhc3MuYWNjZXNzaWJsZUZvcih0aGlzLnN5bmNBYmlsaXR5QWN0aW9uKGZvckRlbGV0ZSA/IFwiZGVzdHJveVwiIDogXCJ1cGRhdGVcIiksIGFiaWxpdHkpXG4gICAgICA6IE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZmluZEJ5KG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnModGhpcy5kYXRhYmFzZVByaW1hcnlLZXkoKSwgbXV0YXRpb24ucmVzb3VyY2VJZCkpXG4gIH1cblxuICAvKipcbiAgICogTWFwcyBhIHJhdyBzeW5jIGFjdGlvbiB0byB0aGUgcmVzb3VyY2UncyBub3JtYWxpemVkIGFiaWxpdHkgYWN0aW9uIHdoZW5cbiAgICogdGhlIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZGVjbGFyZXMgYW4gYWJpbGl0aWVzIG1hcHBpbmcsIG90aGVyd2lzZSB0aGVcbiAgICogcmF3IGFjdGlvbiBuYW1lIGlzIHVzZWQgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gYWN0aW9uIC0gUmF3IHN5bmMgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBYmlsaXR5IGFjdGlvbi5cbiAgICovXG4gIHN5bmNBYmlsaXR5QWN0aW9uKGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWU/LmFiaWxpdGllc1xuXG4gICAgaWYgKGFiaWxpdGllcyAmJiB0eXBlb2YgYWJpbGl0aWVzID09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoYWJpbGl0aWVzKSkge1xuICAgICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWJpbGl0aWVzKVthY3Rpb25dXG5cbiAgICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiA9PSBcInN0cmluZ1wiICYmIGFiaWxpdHlBY3Rpb24ubGVuZ3RoID4gMCkgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gYWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogRnVsbCBlc2NhcGUgaGF0Y2ggZm9yIHJvdXRlZCBzeW5jIG11dGF0aW9uIGFwcGxpY2F0aW9uLiBSZXR1cm5pbmcgYVxuICAgKiBub24tbnVsbCByZXN1bHQgcmVwbGFjZXMgdGhlIHdob2xlIGRlZmF1bHQgYXBwbHkgZmxvdyAoYXV0aG9yaXphdGlvbixcbiAgICogcmVjb3JkIGxvb2t1cCwgbm9ybWFsaXphdGlvbiBhbmQgc2F2ZSkgd2l0aCB0aGUgcmV0dXJuZWQgYXBwbHkgcmVzdWx0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBcHBseVN5bmNBcmdzfSBhcmdzIC0gQXBwbHkgYXJncy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHQgfCBudWxsIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0IHwgbnVsbD59IEFwcGx5IHJlc3VsdCBvciBudWxsIGZvciB0aGUgZGVmYXVsdCBmbG93LlxuICAgKi9cbiAgYXBwbHlTeW5jKGFyZ3MpIHtcbiAgICB2b2lkIGFyZ3NcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBhIHJvdXRlZCBzeW5jIG11dGF0aW9uIHdhcyBhcHBsaWVkLiBSZXR1cm5lZCBlbnRyaWVzIGFyZVxuICAgKiBtZXJnZWQgaW50byB0aGUgYXBwbHkgcmVzdWx0LCByZWFjaGluZyBwZXJzaXN0RXh0cmFBdHRyaWJ1dGVzIGFuZFxuICAgKiBicm9hZGNhc3RzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNyZWF0ZWQgLSBXaGV0aGVyIHRoZSByZWNvcmQgd2FzIGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gYXJncy5yZWNvcmQgLSBBcHBsaWVkIHJlY29yZCBvciBudWxsLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBFeHRyYSBhcHBseS1yZXN1bHQgZW50cmllcy5cbiAgICovXG4gIGFmdGVyU3luY0FwcGx5KHtjb250ZXh0LCBjcmVhdGVkLCBtdXRhdGlvbiwgcmVjb3JkfSkge1xuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgY3JlYXRlZFxuICAgIHZvaWQgbXV0YXRpb25cbiAgICB2b2lkIHJlY29yZFxuXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBjcmVhdGUgYXR0cmlidXRlcyBiZWZvcmUgcGVybWlzc2lvbiBmaWx0ZXJpbmcgYW5kIHNhdmluZy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkPn0gLSBOb3JtYWxpemVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwibm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlc1wiLCBbYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgb3B0aW9uc1xuXG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB1cGRhdGUgYXR0cmlidXRlcyBiZWZvcmUgcGVybWlzc2lvbiBmaWx0ZXJpbmcgYW5kIHNhdmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkPn0gLSBOb3JtYWxpemVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBub3JtYWxpemVVcGRhdGVBdHRyaWJ1dGVzKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcIm5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXNcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBvcHRpb25zXG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBjcmVhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTmV3IG1vZGVsIGJlZm9yZSBhc3NpZ25tZW50L3NhdmUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlQ3JlYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZUNyZWF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBjcmVhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQ3JlYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBhZnRlckNyZWF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlckNyZWF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsIGJlZm9yZSBhc3NpZ25tZW50L3NhdmUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlVXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZVVwZGF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gVXBkYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBhZnRlclVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlclVwZGF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBiZWZvcmUgZGVzdHJveS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVEZXN0cm95KG1vZGVsKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZURlc3Ryb3lcIiwgW21vZGVsXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIERlc3Ryb3llZCBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBhZnRlckRlc3Ryb3kobW9kZWwpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJEZXN0cm95XCIsIFttb2RlbF0sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdyYXBzIGNyZWF0ZS91cGRhdGUvZGVzdHJveSByZXNvdXJjZSBtdXRhdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUcmFuc2FjdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gTXV0YXRpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTXV0YXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJlc3VsdD59IGFyZ3MuY2FsbGJhY2sgLSBNdXRhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5NdXRhdGlvblRyYW5zYWN0aW9uKHthY3Rpb24sIG1vZGVsLCBjYWxsYmFja30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwicnVuTXV0YXRpb25UcmFuc2FjdGlvblwiLCBbe2FjdGlvbiwgbW9kZWwsIGNhbGxiYWNrfV0sIGFzeW5jICgpID0+IHtcbiAgICAgIHZvaWQgYWN0aW9uXG4gICAgICB2b2lkIG1vZGVsXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBQcmltYXJ5IGtleS5cbiAgICovXG4gIHByaW1hcnlLZXkoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuXG4gICAgcmV0dXJuIFJlc291cmNlQ2xhc3MucmVzb2x2ZWRQcmltYXJ5S2V5KHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkYXRhYmFzZSBwcmltYXJ5IGtleS5cbiAgICpcbiAgICogRGVjbGFyZWQgc2NhbGFyIHJlc291cmNlIHByaW1hcnkga2V5cyBhcmUgY2xpZW50LWZhY2luZyBhbGlhc2VzIChmb3IgZXhhbXBsZVxuICAgKiBhIGNhbWVsQ2FzZSBuYW1lIGZvciBhIGxlZ2FjeSByYXctY29sdW1uIHByaW1hcnkga2V5KS4gRGF0YWJhc2UtZmFjaW5nIGlkZW50aXR5XG4gICAqIG9wZXJhdGlvbnMgbXVzdCByZXNvbHZlIHRoZSBhbGlhcyB0byB0aGUgbW9kZWwncyBjYW5vbmljYWwgYXR0cmlidXRlIHNvIHdoZXJlXG4gICAqIGFuZCBwbHVjayBjbGF1c2VzIGhpdCByZWFsIGNvbHVtbnMsIHdoaWxlIGNsaWVudC1mYWNpbmcgcGF5bG9hZHMga2VlcCB0aGUgYWxpYXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIFByaW1hcnkga2V5IHJlc29sdmVkIHRvIGRhdGFiYXNlLXF1ZXJ5YWJsZSBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBkYXRhYmFzZVByaW1hcnlLZXkoKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMucHJpbWFyeUtleSgpXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwcmltYXJ5S2V5KSkgcmV0dXJuIHByaW1hcnlLZXlcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShwcmltYXJ5S2V5KSB8fCBwcmltYXJ5S2V5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdXRob3JpemVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbn0gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXV0aG9yaXplZFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gQXV0aG9yaXphdGlvbiBxdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbiwgb3B0aW9ucykge1xuICAgIC8vIE5hcnJvd3MgdGhlIGNvbnRyb2xsZXIgcXVlcnkgdG8gdGhpcyByZXNvdXJjZSdzIG1vZGVsIGNsYXNzLlxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnkoYWN0aW9uLCBvcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gLSBGcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeS5cbiAgICovXG4gIGluZGV4UXVlcnkob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gKi8gKHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsSW5kZXhRdWVyeSh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgcmVzb3VyY2U6IHRoaXNcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHBhZ2luYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnaW5hdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb259IGFyZ3MucGFnaW5hdGlvbiAtIFBhZ2luYXRpb24gcGFyYW1zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uKHtjb250cm9sbGVyLCBwYWdpbmF0aW9uLCBxdWVyeX0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFBhZ2luYXRpb24oe3BhZ2luYXRpb24sIHF1ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNlYXJjaGVzLCBleHBhbmRpbmcgYSBkZWNsYXJlZCBxdWljayBzZWFyY2hcbiAgICogYmVmb3JlIGZhbGxpbmcgYmFjayB0byB0aGUgY29udHJvbGxlciBkZWZhdWx0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlYXJjaCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTZWFyY2goe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgaWYgKHRoaXMuYXBwbHlRdWlja1NlYXJjaCh7Y29udHJvbGxlciwgcXVlcnksIHNlYXJjaH0pKSByZXR1cm5cblxuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHBhbmRzIGEgYHF1aWNrU2VhcmNoYCBwc2V1ZG8tY29sdW1uIHNlYXJjaCBpbnRvIGFuIE9SIG9mIExJS0UgY29uZGl0aW9uc1xuICAgKiBvdmVyIHRoZSBkZWNsYXJlZCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5xdWlja1NlYXJjaENvbHVtbnN9LCBwbHVzXG4gICAqIGV4YWN0IGA9YCBjb25kaXRpb25zIG92ZXIge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucXVpY2tTZWFyY2hOdW1lcmljQ29sdW1uc31cbiAgICogd2hlbiB0aGUgdHJpbW1lZCB2YWx1ZSBpcyBhIHNhZmUgbm9uLW5lZ2F0aXZlIGludGVnZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSB0byBmaWx0ZXIuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBzZWFyY2ggd2FzIGhhbmRsZWQgYXMgYSBxdWljayBzZWFyY2guXG4gICAqL1xuICBhcHBseVF1aWNrU2VhcmNoKHtjb250cm9sbGVyLCBxdWVyeSwgc2VhcmNofSkge1xuICAgIGNvbnN0IHF1aWNrU2VhcmNoQ29sdW1ucyA9IHRoaXMucXVpY2tTZWFyY2hDb2x1bW5EZWZpbml0aW9ucygpXG5cbiAgICBpZiAoIXF1aWNrU2VhcmNoQ29sdW1ucyB8fCBxdWlja1NlYXJjaENvbHVtbnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoc2VhcmNoLnBhdGgubGVuZ3RoID4gMCB8fCBzZWFyY2guY29sdW1uICE9PSBRVUlDS19TRUFSQ0hfQ09MVU1OKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChzZWFyY2gub3BlcmF0b3IgIT09IFwibGlrZVwiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGAke3RoaXMucXVpY2tTZWFyY2hFcnJvckxhYmVsKCl9IG11c3QgdXNlIHRoZSBsaWtlIG9wZXJhdG9yLmAsIHtjb2RlOiB0aGlzLnF1aWNrU2VhcmNoRXJyb3JDb2RlKCl9KVxuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygc2VhcmNoLnZhbHVlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGAke3RoaXMucXVpY2tTZWFyY2hFcnJvckxhYmVsKCl9IG11c3QgYmUgYSBzdHJpbmcuYCwge2NvZGU6IHRoaXMucXVpY2tTZWFyY2hFcnJvckNvZGUoKX0pXG4gICAgfVxuXG4gICAgY29uc3QgdHJpbW1lZFZhbHVlID0gc2VhcmNoLnZhbHVlLnRyaW0oKVxuXG4gICAgaWYgKCF0cmltbWVkVmFsdWUpIHJldHVybiB0cnVlXG5cbiAgICBjb25zdCBjb25kaXRpb25zID0gcXVpY2tTZWFyY2hDb2x1bW5zLm1hcCgoY29sdW1uKSA9PiAoXG4gICAgICBgJHt0aGlzLnF1aWNrU2VhcmNoQ29sdW1uU3FsKHtjb2x1bW4sIGNvbnRyb2xsZXIsIHF1ZXJ5fSl9IExJS0UgJHtxdWVyeS5kcml2ZXIucXVvdGUoYCUke3RyaW1tZWRWYWx1ZX0lYCl9YFxuICAgICkpXG4gICAgY29uc3QgbnVtZXJpY1NlYXJjaFZhbHVlID0gcXVpY2tTZWFyY2hOdW1lcmljVmFsdWUodHJpbW1lZFZhbHVlKVxuXG4gICAgaWYgKG51bWVyaWNTZWFyY2hWYWx1ZSAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgcXVpY2tTZWFyY2hOdW1lcmljQ29sdW1ucyA9IHRoaXMucXVpY2tTZWFyY2hOdW1lcmljQ29sdW1uRGVmaW5pdGlvbnMoKSB8fCBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiBxdWlja1NlYXJjaE51bWVyaWNDb2x1bW5zKSB7XG4gICAgICAgIGNvbmRpdGlvbnMucHVzaChgJHt0aGlzLnF1aWNrU2VhcmNoQ29sdW1uU3FsKHtjb2x1bW4sIGNvbnRyb2xsZXIsIHF1ZXJ5fSl9ID0gJHtxdWVyeS5kcml2ZXIucXVvdGUobnVtZXJpY1NlYXJjaFZhbHVlKX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHF1ZXJ5LndoZXJlKGAoJHtjb25kaXRpb25zLmpvaW4oXCIgT1IgXCIpfSlgKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGVjbGFyZWQgcXVpY2stc2VhcmNoIHRleHQgY29sdW1ucyB0aHJvdWdoIHRoZSBzaGFyZWQgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHtBcnJheTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxRdWlja1NlYXJjaENvbHVtbiB8IHN0cmluZz4gfCBudWxsIHwgdW5kZWZpbmVkfSAtIERlY2xhcmVkIGNvbHVtbnMuXG4gICAqL1xuICBxdWlja1NlYXJjaENvbHVtbkRlZmluaXRpb25zKCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcblxuICAgIHJldHVybiAvKiogQHR5cGUge0FycmF5PGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFF1aWNrU2VhcmNoQ29sdW1uIHwgc3RyaW5nPiB8IG51bGwgfCB1bmRlZmluZWR9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJxdWlja1NlYXJjaENvbHVtbnNcIikpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHF1aWNrLXNlYXJjaCBudW1lcmljIGNvbHVtbnMgdGhyb3VnaCB0aGUgc2hhcmVkIHJlc291cmNlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUXVpY2tTZWFyY2hDb2x1bW4gfCBzdHJpbmc+IHwgbnVsbCB8IHVuZGVmaW5lZH0gLSBEZWNsYXJlZCBjb2x1bW5zLlxuICAgKi9cbiAgcXVpY2tTZWFyY2hOdW1lcmljQ29sdW1uRGVmaW5pdGlvbnMoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUXVpY2tTZWFyY2hDb2x1bW4gfCBzdHJpbmc+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInF1aWNrU2VhcmNoTnVtZXJpY0NvbHVtbnNcIikpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBxdW90ZWQgU1FMIHJlZmVyZW5jZSBmb3Igb25lIHF1aWNrLXNlYXJjaCBjb2x1bW4sIGFkZGluZyB0aGVcbiAgICogcmVsYXRpb25zaGlwIGpvaW4gd2hlbiB0aGUgY29sdW1uIHNpdHMgb24gYSBqb2luZWQgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb2x1bW4gYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxRdWlja1NlYXJjaENvbHVtbiB8IHN0cmluZ30gYXJncy5jb2x1bW4gLSBDb2x1bW4gZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBiZWluZyBmaWx0ZXJlZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBRdW90ZWQgU1FMIGNvbHVtbiByZWZlcmVuY2UuXG4gICAqL1xuICBxdWlja1NlYXJjaENvbHVtblNxbCh7Y29sdW1uLCBjb250cm9sbGVyLCBxdWVyeX0pIHtcbiAgICBjb25zdCBjb2x1bW5Db25maWcgPSB0eXBlb2YgY29sdW1uID09PSBcInN0cmluZ1wiID8ge2NvbHVtbn0gOiBjb2x1bW5cbiAgICBjb25zdCBwYXRoID0gY29sdW1uQ29uZmlnLnBhdGggfHwgW11cblxuICAgIGlmIChwYXRoLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnRyb2xsZXIuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoLCBxdWVyeX0pXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aClcblxuICAgIHJldHVybiBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbkNvbmZpZy5jb2x1bW4pfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBIdW1hbi1yZWFkYWJsZSBsYWJlbCB1c2VkIGluIGludmFsaWQgcXVpY2stc2VhcmNoIHBheWxvYWQgZXJyb3JzLiBPd25lcnNcbiAgICogd2l0aCBhbiBlc3RhYmxpc2hlZCBwdWJsaWMgZXJyb3IgY29udHJhY3QgbWF5IG92ZXJyaWRlIHRoaXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRXJyb3IgbGFiZWwuXG4gICAqL1xuICBxdWlja1NlYXJjaEVycm9yTGFiZWwoKSB7XG4gICAgcmV0dXJuIFwiUXVpY2sgc2VhcmNoXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBFcnJvciBjb2RlIHVzZWQgZm9yIGludmFsaWQgcXVpY2stc2VhcmNoIHBheWxvYWQgZXJyb3JzLiBPd25lcnMgd2l0aCBhblxuICAgKiBlc3RhYmxpc2hlZCBwdWJsaWMgZXJyb3IgY29udHJhY3QgbWF5IG92ZXJyaWRlIHRoaXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRXJyb3IgY29kZS5cbiAgICovXG4gIHF1aWNrU2VhcmNoRXJyb3JDb2RlKCkge1xuICAgIHJldHVybiBcImludmFsaWQtcXVpY2stc2VhcmNoXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU29ydCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU29ydH0gYXJncy5zb3J0IC0gU29ydCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTb3J0KHtjb250cm9sbGVyLCBxdWVyeSwgc29ydH0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNvcnQoe3F1ZXJ5LCBzb3J0fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIHBsdWNrLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHBsdWNrIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzUGx1Y2soYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykucmVjb3JkcyA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUucmVjb3Jkc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgY291bnQuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY291bnQgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNDb3VudChhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5yZWNvcmRzID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5yZWNvcmRzIHx8XG4gICAgICBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykuY291bnQgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLmNvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgdm9pZCB8IFByb21pc2U8Ym9vbGVhbiB8IHZvaWQ+fSAtIENvbnRpbnVlIHByb2Nlc3NpbmcgdW5sZXNzIGZhbHNlLlxuICAgKi9cbiAgYmVmb3JlQWN0aW9uKGFjdGlvbikge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVBY3Rpb25cIiwgW2FjdGlvbl0sICgpID0+IHtcbiAgICAgIHZvaWQgYWN0aW9uXG5cbiAgICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHQuXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIFJlY29yZHMgZm9yIGluZGV4IGFjdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29yZHMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5kZXhRdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5kZXggcXVlcnkgb3B0aW9ucyBmb3IgY291bnQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gLSBJbmRleCBxdWVyeSBvcHRpb25zIGZvciBjb3VudC5cbiAgICovXG4gIGNvdW50SW5kZXhRdWVyeU9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZWNvcmRzIGNvdW50IGZvciBpbmRleCBhY3Rpb24uXG4gICAqL1xuICBhc3luYyBjb3VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KHRoaXMuY291bnRJbmRleFF1ZXJ5T3B0aW9ucygpKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gTG9jYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmQoYWN0aW9uLCBpZCkge1xuICAgIGxldCBxdWVyeSA9IHRoaXMuYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICBjb25zdCBwcmVsb2FkID0gYWN0aW9uID09PSBcImZpbmRcIiA/IHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsUHJlbG9hZCgpIDogbnVsbFxuXG4gICAgaWYgKHByZWxvYWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyh0aGlzLmRhdGFiYXNlUHJpbWFyeUtleSgpLCBpZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIENyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBDcmVhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5ub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJjcmVhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuZGF0YWJhc2VNb2RlbENsYXNzKClcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoTW9kZWxDbGFzcy5wcm90b3R5cGUsIE1vZGVsQ2xhc3MsIGF0dGFjaG1lbnRTcGxpdC5hdHRyaWJ1dGVzLCB0aGlzLCBwZXJtaXQuYXR0cmlidXRlcylcbiAgICBjb25zdCBtb2RlbCA9IG5ldyBNb2RlbENsYXNzKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe1xuICAgICAgYWN0aW9uOiBcImNyZWF0ZVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZUNyZWF0ZShtb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgICAgIGNvbnN0IHNhdmVkTW9kZWwgPSBhd2FpdCB0aGlzLl9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9uczogey4uLm9wdGlvbnMsIGF0dGFjaG1lbnRzOiBhdHRhY2htZW50U3BsaXQuYXR0YWNobWVudHN9LCBwZXJtaXR9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJDcmVhdGUoc2F2ZWRNb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG5cbiAgICAgICAgcmV0dXJuIHNhdmVkTW9kZWxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFuZGxlIHVuYXV0aG9yaXplZCBjcmVhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIENyZWF0ZWQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIENsZWFudXAgYWZ0ZXIgZmFpbGVkIGF1dGhvcml6YXRpb24uXG4gICAqL1xuICBhc3luYyBoYW5kbGVVbmF1dGhvcml6ZWRDcmVhdGVkTW9kZWwobW9kZWwpIHtcbiAgICBhd2FpdCBtb2RlbC5kZXN0cm95KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gVXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IFtvcHRpb25zXSAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyB1cGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5ub3JtYWxpemVVcGRhdGVBdHRyaWJ1dGVzKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRTcGxpdCA9IHRoaXMuX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsKVxuICAgIGNvbnN0IHBlcm1pdCA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwidXBkYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiBub3JtYWxpemVkQXR0cmlidXRlc30pKVxuICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbCwgbW9kZWwuZ2V0TW9kZWxDbGFzcygpLCBhdHRhY2htZW50U3BsaXQuYXR0cmlidXRlcywgdGhpcywgcGVybWl0LmF0dHJpYnV0ZXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgIG1vZGVsLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWZvcmVVcGRhdGUobW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgICAgICBjb25zdCBzYXZlZE1vZGVsID0gYXdhaXQgdGhpcy5fc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnM6IHsuLi5vcHRpb25zLCBhdHRhY2htZW50czogYXR0YWNobWVudFNwbGl0LmF0dGFjaG1lbnRzfSwgcGVybWl0fSlcblxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyVXBkYXRlKHNhdmVkTW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuXG4gICAgICAgIHJldHVybiBzYXZlZE1vZGVsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBhIG1vZGVsIGFuZCBhcHBsaWVzIG5lc3RlZCBhdHRyaWJ1dGVzIGluIG9uZSB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHt7ZmlsdGVyZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbW9kZWw6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBvcHRpb25zOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9ucywgcGVybWl0OiB7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX19IGFyZ3MgLSBTYXZlIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIFNhdmVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zLCBwZXJtaXR9KSB7XG4gICAgYXdhaXQgdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMobW9kZWwsIGZpbHRlcmVkKVxuICAgICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMobW9kZWwsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbCwgcGVybWl0LmF0dHJpYnV0ZXMpXG5cbiAgICAgIGlmIChvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKG1vZGVsLCBvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMsIG9wdGlvbnMuY29udHJvbGxlciB8fCBudWxsLCBwZXJtaXQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICBpZiAob3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhtb2RlbCwgb3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmNvbnRyb2xsZXIgfHwgbnVsbCwgcGVybWl0KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIGF0dHJpYnV0ZXMgdG8gYSBtb2RlbCwgdXNpbmcgdmlydHVhbCBzZXR0ZXJzIG9uIHRoZSByZXNvdXJjZSB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKG1vZGVsLCBhdHRyaWJ1dGVzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZGlyZWN0QXR0cmlidXRlcyA9IHt9XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KFJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXSlcblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX1BdHRyaWJ1dGVgXG4gICAgICBjb25zdCByZXNvdXJjZVNldHRlciA9IHRoaXMucmVzb3VyY2VNZXRob2QocmVzb3VyY2VTZXR0ZXJOYW1lKVxuXG4gICAgICBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgICAgYXdhaXQgcmVzb3VyY2VTZXR0ZXIubWV0aG9kLmNhbGwocmVzb3VyY2VTZXR0ZXIucmVzb3VyY2UsIG1vZGVsLCB2YWx1ZSlcbiAgICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMobmFtZSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGlyZWN0QXR0cmlidXRlc1tuYW1lXSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGRpcmVjdEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIG1vZGVsLmFzc2lnbihkaXJlY3RBdHRyaWJ1dGVzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgYXR0YWNobWVudC1uYW1lZCBhdHRyaWJ1dGVzIGludG8gdGhlIGF0dGFjaG1lbnQgcGF5bG9hZCB3aGlsZSBwcmVzZXJ2aW5nIGxlZ2FjeSBjYWxsZXJzXG4gICAqIHRoYXQgc3VibWl0dGVkIGF0dGFjaG1lbnRzIGFzIG5vcm1hbCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gYXR0YWNobWVudHMgLSBFeHBsaWNpdCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhdHRhY2htZW50czogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH19IEF0dHJpYnV0ZXMgd2l0aCBhdHRhY2htZW50IGtleXMgcmVtb3ZlZCBhbmQgbWVyZ2VkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIF9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMoYXR0cmlidXRlcywgYXR0YWNobWVudHMpIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSB0aGlzLm1vZGVsQ2xhc3MoKS5hdHRhY2htZW50RGVmaW5pdGlvbnMoKVxuICAgIGNvbnN0IGF0dGFjaG1lbnROYW1lcyA9IG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0YWNobWVudERlZmluaXRpb25zKSlcblxuICAgIGlmIChhdHRhY2htZW50TmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIHthdHRyaWJ1dGVzLCBhdHRhY2htZW50c31cblxuICAgIGlmIChhdHRhY2htZW50cyAhPT0gbnVsbCAmJiAhaXNQbGFpbk9iamVjdChhdHRhY2htZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGF0dGFjaG1lbnRzIHRvIGJlIGFuIG9iamVjdC5cIilcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByZWd1bGFyQXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAqL1xuICAgIGxldCBtZXJnZWRBdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzID8gey4uLmF0dGFjaG1lbnRzfSA6IG51bGxcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgICAgaWYgKCFhdHRhY2htZW50TmFtZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIHJlZ3VsYXJBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKCFtZXJnZWRBdHRhY2htZW50cykgbWVyZ2VkQXR0YWNobWVudHMgPSB7fVxuICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtZXJnZWRBdHRhY2htZW50cywgYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICcke2F0dHJpYnV0ZU5hbWV9JyB3YXMgc3VibWl0dGVkIGluIGJvdGggYXR0cmlidXRlcyBhbmQgYXR0YWNobWVudHMuYClcbiAgICAgIH1cblxuICAgICAgbWVyZ2VkQXR0YWNobWVudHNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiB7YXR0cmlidXRlczogcmVndWxhckF0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzOiBtZXJnZWRBdHRhY2htZW50c31cbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgYXR0YWNobWVudCBwYXlsb2FkcyBvbiBhIG1vZGVsIGFmdGVyIHZhbGlkYXRpbmcgcGVybWl0cyBhbmQgYXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCByZWNlaXZpbmcgYXR0YWNobWVudHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gYXR0YWNobWVudHMgLSBBdHRhY2htZW50cyBrZXllZCBieSBhdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzIC0gQXR0cmlidXRlL2F0dGFjaG1lbnQgbmFtZXMgcGVybWl0dGVkIGJ5IHRoZSByZXNvdXJjZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfYXNzaWduQXR0YWNobWVudHMobW9kZWwsIGF0dGFjaG1lbnRzLCBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykge1xuICAgIGlmICghYXR0YWNobWVudHMpIHJldHVyblxuICAgIGlmICghaXNQbGFpbk9iamVjdChhdHRhY2htZW50cykpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGF0dGFjaG1lbnRzIHRvIGJlIGFuIG9iamVjdC5cIilcblxuICAgIGNvbnN0IHBlcm1pdFNldCA9IG5ldyBTZXQocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IG1vZGVsLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IG1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3Qgbm90UGVybWl0dGVkQXR0YWNobWVudHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgaW52YWxpZEF0dGFjaG1lbnRzID0gW11cblxuICAgIGZvciAoY29uc3QgW2F0dGFjaG1lbnROYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0YWNobWVudHMpKSB7XG4gICAgICBpZiAoIXBlcm1pdFNldC5oYXMoYXR0YWNobWVudE5hbWUpKSB7XG4gICAgICAgIG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLnB1c2goYXR0YWNobWVudE5hbWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBpZiAoIWF0dGFjaG1lbnREZWZpbml0aW9uc1thdHRhY2htZW50TmFtZV0pIHtcbiAgICAgICAgaW52YWxpZEF0dGFjaG1lbnRzLnB1c2goYXR0YWNobWVudE5hbWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLnF1ZXVlQXR0YWNoKHZhbHVlKVxuICAgIH1cblxuICAgIGlmIChub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBGcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IG5hbWVzIG5vdCBwZXJtaXR0ZWQgYnkgcGVybWl0dGVkUGFyYW1zKCk6ICR7bm90UGVybWl0dGVkQXR0YWNobWVudHMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgICB9XG4gICAgaWYgKGludmFsaWRBdHRhY2htZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgbmFtZXM6ICR7aW52YWxpZEF0dGFjaG1lbnRzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgYSB0cmFuc2xhdGVkIGF0dHJpYnV0ZSBvbiBhIG1vZGVsIHZpYSB0aGUgdHJhbnNsYXRpb25zIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IHZhbHVlIC0gQXR0cmlidXRlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9zZXRUcmFuc2xhdGVkQXR0cmlidXRlT25Nb2RlbChtb2RlbCwgbmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5jb250ZXh0Py5jb25maWd1cmF0aW9uXG4gICAgY29uc3QgbG9jYWxlID0gY29uZmlndXJhdGlvbiA/IGNvbmZpZ3VyYXRpb24uZ2V0TG9jYWxlKCkgOiBcImVuXCJcbiAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgdHJhbnNsYXRpb25cblxuICAgIGlmIChtb2RlbC5pc05ld1JlY29yZCgpKSB7XG4gICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgIHRyYW5zbGF0aW9uID0gbG9hZGVkLmZpbmQoKHQpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodCkubG9jYWxlKCkgPT09IGxvY2FsZSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkge1xuICAgICAgICBhd2FpdCBtb2RlbC5sb2FkUmVsYXRpb25zaGlwKFwidHJhbnNsYXRpb25zXCIpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgdHJhbnNsYXRpb24gPSBsb2FkZWQuZmluZCgodCkgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0KS5sb2NhbGUoKSA9PT0gbG9jYWxlKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghdHJhbnNsYXRpb24pIHtcbiAgICAgIHRyYW5zbGF0aW9uID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuYnVpbGQoe2xvY2FsZX0pXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXNzaWdubWVudHMgPSB7fVxuXG4gICAgYXNzaWdubWVudHNbbmFtZV0gPSB2YWx1ZVxuICAgIHRyYW5zbGF0aW9uLmFzc2lnbihhc3NpZ25tZW50cylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGRlc3Ryb3kobW9kZWwpIHtcbiAgICBhd2FpdCB0aGlzLnJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe1xuICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgIG1vZGVsLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWZvcmVEZXN0cm95KG1vZGVsKVxuICAgICAgICBhd2FpdCBtb2RlbC5kZXN0cm95KClcbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlckRlc3Ryb3kobW9kZWwpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCB0byBzZXJpYWxpemUuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIn0gW2FjdGlvbl0gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2VyaWFsaXplZCBtb2RlbCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplKG1vZGVsLCBhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5zZXJpYWxpemVGcm9udGVuZE1vZGVsKG1vZGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGNvbW1vbiBtZXRhZGF0YSBmb3Igb25lIG5lc3RlZC1hdHRyaWJ1dGVzIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOZXN0ZWQgcmVsYXRpb25zaGlwIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgcmVjZWl2aW5nIG5lc3RlZCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gYXJncy5yYXdFbnRyaWVzIC0gUmF3IG5lc3RlZCBlbnRyaWVzIGZyb20gdGhlIHJlcXVlc3QgcGF5bG9hZC5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncy5jaGlsZFBlcm1pdCAtIFBhcnNlZCBjaGlsZCBwZXJtaXQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIGNoaWxkIHJlc291cmNlIGxvb2t1cC5cbiAgICogQHJldHVybnMge3thYmlsaXR5OiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgY2hpbGRQcmltYXJ5S2V5OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9uLCBjaGlsZFJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLCBjaGlsZFJlc291cmNlQ29uZmlnOiBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSwgZGVzdHJveVBlcm1pdHRlZDogYm9vbGVhbiwgZW50cmllczogQXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+LCByZWxhdGlvbnNoaXA6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCwgdGFyZ2V0TW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gTmVzdGVkIHJlbGF0aW9uc2hpcCBjb250ZXh0LlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe3BhcmVudCwgcmVsYXRpb25zaGlwTmFtZSwgcmF3RW50cmllcywgY2hpbGRQZXJtaXQsIGNvbnRyb2xsZXJ9KSB7XG4gICAgaWYgKCFjb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgcmVxdWlyZSBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcbiAgICB9XG5cbiAgICBjb25zdCBwYXJlbnRNb2RlbENsYXNzID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IG1vZGVsQWNjZXB0YW5jZSA9IHBhcmVudE1vZGVsQ2xhc3MuYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIW1vZGVsQWNjZXB0YW5jZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWNjZXB0IG5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIERlY2xhcmUgaXQgdmlhICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScpLmApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcGFyZW50TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgIGNvbnN0IHJhd05vcm1hbGl6ZWRFbnRyaWVzID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pXG4gICAgY29uc3QgZGVzdHJveVBlcm1pdHRlZCA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJfZGVzdHJveVwiKVxuXG4gICAgaWYgKGRlc3Ryb3lQZXJtaXR0ZWQgJiYgIW1vZGVsQWNjZXB0YW5jZS5hbGxvd0Rlc3Ryb3kpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgcGVybWl0cyBfZGVzdHJveSBvbiBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IHRoZSBtb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWxsb3cgZGVzdHJveSBmb3IgdGhhdCByZWxhdGlvbnNoaXAuIFNldCB7YWxsb3dEZXN0cm95OiB0cnVlfSBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nLCAuLi4pLmApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLmxpbWl0ID09PSBcIm51bWJlclwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IG1vZGVsQWNjZXB0YW5jZS5saW1pdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZXhjZWVkcyBtb2RlbC1kZWNsYXJlZCBsaW1pdCBvZiAke21vZGVsQWNjZXB0YW5jZS5saW1pdH0uYClcbiAgICB9XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzTWFueVwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGFjY2VwdHMgb25lIGVudHJ5IGZvciAke3JlbGF0aW9uc2hpcFR5cGV9IHJlbGF0aW9uc2hpcHMuYClcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyByZXNvbHZlZCBmb3IgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlQ29uZmlnID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCFjaGlsZFJlc291cmNlQ29uZmlnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdGVyZWQgZm9yIGNoaWxkIG1vZGVsICcke3RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyB1bmRlciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nLmApXG4gICAgfVxuXG4gICAgY29uc3QgQ2hpbGRSZXNvdXJjZSA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNsYXNzKVxuICAgIGNvbnN0IGNoaWxkUmVzb3VyY2UgPSBuZXcgQ2hpbGRSZXNvdXJjZSh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0IHx8IHt9LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBtb2RlbE5hbWU6IGNoaWxkUmVzb3VyY2VDb25maWcubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNoaWxkUHJpbWFyeUtleSA9IGNoaWxkUmVzb3VyY2UucHJpbWFyeUtleSgpXG4gICAgY29uc3QgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMgPSBjaGlsZFBlcm1pdC5hdHRyaWJ1dGVzLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJfZGVzdHJveVwiKVxuICAgIGNvbnN0IGVudHJpZXMgPSByYXdOb3JtYWxpemVkRW50cmllc1xuICAgICAgLm1hcCgoZW50cnkpID0+IHRoaXMuX25vcm1hbGl6ZU5lc3RlZFJlbGF0aW9uc2hpcEVudHJ5KHtjaGlsZFBlcm1pdCwgY2hpbGRQcmltYXJ5S2V5LCBlbnRyeSwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pKVxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBtb2RlbEFjY2VwdGFuY2UucmVqZWN0SWYgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHRydWVcblxuICAgICAgICByZXR1cm4gIW1vZGVsQWNjZXB0YW5jZS5yZWplY3RJZihpc1BsYWluT2JqZWN0KGVudHJ5LmF0dHJpYnV0ZXMpID8gZW50cnkuYXR0cmlidXRlcyA6IHt9KVxuICAgICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICBhYmlsaXR5OiBjb250cm9sbGVyLmN1cnJlbnRBYmlsaXR5KCkgfHwgdGhpcy5hYmlsaXR5LFxuICAgICAgY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgY2hpbGRSZXNvdXJjZSxcbiAgICAgIGNoaWxkUmVzb3VyY2VDb25maWcsXG4gICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgIGRlc3Ryb3lQZXJtaXR0ZWQsXG4gICAgICBlbnRyaWVzLFxuICAgICAgcmVsYXRpb25zaGlwLFxuICAgICAgdGFyZ2V0TW9kZWxDbGFzc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG5lc3RlZCBlbnRyaWVzIGZvciBjb2xsZWN0aW9uIGFuZCBzaW5ndWxhciByZWxhdGlvbnNoaXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5lc3RlZCBlbnRyaWVzIGlucHV0cy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IGFyZ3MucmF3RW50cmllcyAtIFJhdyBuZXN0ZWQgZW50cmllcyB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBUeXBlIC0gUmVsYXRpb25zaGlwIHR5cGUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeT59IE5vcm1hbGl6ZWQgbmVzdGVkIGVudHJ5IG9iamVjdHMuXG4gICAqL1xuICBfbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pIHtcbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShyYXdFbnRyaWVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFycmF5IGZvciBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IGdvdDogJHt0eXBlb2YgcmF3RW50cmllc31gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmF3RW50cmllcy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdChlbnRyeSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzLmApXG5cbiAgICAgICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAoZW50cnkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChyYXdFbnRyaWVzID09IG51bGwpIHJldHVybiBbXVxuICAgIGlmIChBcnJheS5pc0FycmF5KHJhd0VudHJpZXMpKSB7XG4gICAgICByZXR1cm4gcmF3RW50cmllcy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdChlbnRyeSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzLmApXG5cbiAgICAgICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAoZW50cnkpXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2JqZWN0IGZvciBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IGdvdDogJHt0eXBlb2YgcmF3RW50cmllc31gKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgIHJldHVybiBbLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKHJhd0VudHJpZXMpXVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIG5lc3RlZCBlbnRyeSBmcm9tIGVpdGhlciBpbnRlcm5hbCB0cmFuc3BvcnQgc2hhcGVcbiAgICogKGB7YXR0cmlidXRlcywgYXR0YWNobWVudHMsIG5lc3RlZEF0dHJpYnV0ZXN9YCkgb3IgZGlyZWN0IFJhaWxzLXN0eWxlXG4gICAqIGZpZWxkcyAoYHtuYW1lLCBmaWxlLCBjb21tZW50c0F0dHJpYnV0ZXN9YCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTm9ybWFsaXphdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MuY2hpbGRQZXJtaXQgLSBQYXJzZWQgY2hpbGQgcGVybWl0IHNwZWMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gYXJncy5jaGlsZFByaW1hcnlLZXkgLSBSZXNvbHZlZCBjaGlsZCByZXNvdXJjZSBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gYXJncy5lbnRyeSAtIFJhdyBuZXN0ZWQgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeS5cbiAgICovXG4gIF9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGNoaWxkUHJpbWFyeUtleSwgZW50cnksIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHt9XG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSAqL1xuICAgIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRBdHRhY2htZW50c01hcCgpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZW50cnkpKSB7XG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJpZFwiKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNoaWxkUHJpbWFyeUtleSkpIHtcbiAgICAgICAgICBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKGNoaWxkUHJpbWFyeUtleSwgdmFsdWUpXG4gICAgICAgICAgbm9ybWFsaXplZC5pZCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9ICovICh2YWx1ZSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgaWQgbXVzdCBiZSBhIHN0cmluZyBvciBudW1iZXIuYClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBub3JtYWxpemVkLmlkID0gdmFsdWVcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJfZGVzdHJveVwiKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgX2Rlc3Ryb3kgbXVzdCBiZSBhIGJvb2xlYW4uYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5vcm1hbGl6ZWQuX2Rlc3Ryb3kgPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJhdHRyaWJ1dGVzXCIpIHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgYXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dHJpYnV0ZXMsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJhdHRhY2htZW50c1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dGFjaG1lbnRzIG11c3QgYmUgYW4gb2JqZWN0LmApXG4gICAgICAgIE9iamVjdC5hc3NpZ24oYXR0YWNobWVudHMsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJuZXN0ZWRBdHRyaWJ1dGVzXCIpIHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgbmVzdGVkQXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKG5lc3RlZEF0dHJpYnV0ZXMsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgICAgY29uc3QgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcblxuICAgICAgICBpZiAoIW5lc3RlZFJlbGF0aW9uc2hpcE5hbWUpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBuZXN0ZWQgYXR0cmlidXRlcyBrZXk6ICR7YXR0cmlidXRlTmFtZX1gKVxuICAgICAgICBpZiAoIWNoaWxkUGVybWl0Lm5lc3RlZFtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke25lc3RlZFJlbGF0aW9uc2hpcE5hbWV9JyBhcmUgbm90IHBlcm1pdHRlZCB1bmRlciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIEluY2x1ZGUgeyR7YXR0cmlidXRlTmFtZX06IFsuLi5dfSBpbiB0aGF0IG5lc3RlZCBwZXJtaXQuYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb25zW2F0dHJpYnV0ZU5hbWVdKSB7XG4gICAgICAgIGF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBub3JtYWxpemVkLmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBub3JtYWxpemVkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGJlbG9uZ3MtdG8gbmVzdGVkIGF0dHJpYnV0ZXMgYmVmb3JlIHRoZSBwYXJlbnQgc2F2ZSBzbyB0aGUgcGFyZW50IEZLIGNhbiBiZSBzZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBuZXN0ZWRBdHRyaWJ1dGVzIC0gTmVzdGVkLWF0dHJpYnV0ZSBwYXlsb2FkIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBjb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgcmVzb3VyY2UgcmVzb2x1dGlvbiBhbmQgYXV0aG9yaXphdGlvbi5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IG51bGx9IFtwYXJlbnRQZXJtaXRdIC0gUGFyc2VkIHBhcmVudCBwZXJtaXQgc3BlYy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKHBhcmVudCwgbmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgcGFyZW50UGVybWl0ID0gbnVsbCkge1xuICAgIGNvbnN0IHJlc29sdmVkUGFyZW50ID0gcGFyZW50UGVybWl0XG4gICAgICB8fCBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczoge319KSlcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgY2hpbGRQZXJtaXQgPSByZXNvbHZlZFBhcmVudC5uZXN0ZWRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFjaGlsZFBlcm1pdCkgY29udGludWVcblxuICAgICAgY29uc3QgY29udGV4dCA9IHRoaXMuX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe1xuICAgICAgICBjaGlsZFBlcm1pdCxcbiAgICAgICAgY29udHJvbGxlcixcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByYXdFbnRyaWVzOiBuZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lXG4gICAgICB9KVxuXG4gICAgICBpZiAoY29udGV4dC5yZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKGNvbnRleHQucmVsYXRpb25zaGlwLCBwYXJlbnQuZ2V0TW9kZWxDbGFzcygpKVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRleHQuZW50cmllcykge1xuICAgICAgICBpZiAoZW50cnkuX2Rlc3Ryb3kpIHtcbiAgICAgICAgICBpZiAoIWNvbnRleHQuZGVzdHJveVBlcm1pdHRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgcmVxdWVzdGVkIF9kZXN0cm95IGJ1dCBcIl9kZXN0cm95XCIgaXMgbm90IGluIHRoZSBwZXJtaXQgZm9yIHRoaXMgcmVsYXRpb25zaGlwLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcblxuICAgICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcblxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fZmluZE5lc3RlZFJlY29yZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgICAgICAgY2hpbGRQcmltYXJ5S2V5OiBjb250ZXh0LmNoaWxkUHJpbWFyeUtleSxcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgICAgIHBhcmVudC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgbnVsbClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuICAgICAgICBjb25zdCBjaGlsZCA9IGlkICE9IHVuZGVmaW5lZFxuICAgICAgICAgID8gYXdhaXQgdGhpcy5fZmluZE5lc3RlZFJlY29yZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBpZCxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgY2hpbGQuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2F1dGhvcml6ZUNyZWF0ZWRDaGlsZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIGNoaWxkUHJpbWFyeUtleTogY29udGV4dC5jaGlsZFByaW1hcnlLZXksXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cblxuICAgICAgICBwYXJlbnQuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKGNoaWxkLmlkKCksIGBOZXN0ZWQgYmVsb25ncy10byB3cml0ZSBmb3IgJHtjaGlsZC5nZXRNb2RlbENsYXNzKCkubmFtZX1gKSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGBuZXN0ZWRBdHRyaWJ1dGVzYCBwYXlsb2FkIHRvIGEgZnJlc2hseS1zYXZlZCBwYXJlbnQgbW9kZWwsXG4gICAqIGNhc2NhZGluZyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgd3JpdGVzIGFjcm9zcyB0aGUgZGVjbGFyZWQgcmVsYXRpb25zaGlwcy5cbiAgICpcbiAgICogRWFjaCBjaGlsZCBpcyBhdXRob3JpemVkIGFnYWluc3QgaXRzIG93biByZXNvdXJjZSdzIGFiaWxpdGllcyAobmV2ZXIgdGhlXG4gICAqIHBhcmVudCdzKS4gRGVzdHJveXMgcnVuIGJlZm9yZSB1cGRhdGVzLCB1cGRhdGVzIGJlZm9yZSBjcmVhdGVzLCB0byBhdm9pZFxuICAgKiB1bmlxdWUtY29uc3RyYWludCBjb25mbGljdHMgd2hlbiByZXBsYWNpbmcgYSBjaGlsZCBhdCB0aGUgc2FtZSBuYXR1cmFsIGtleS5cbiAgICpcbiAgICogQXR0cmlidXRlIGZpbHRlcmluZyBmb3IgbmVzdGVkIGNoaWxkcmVuIHVzZXMgdGhlIHBhcmVudCByZXNvdXJjZSdzXG4gICAqIHBlcm1pdCBzcGVjIGZvciB0aGF0IHJlbGF0aW9uc2hpcCDigJQgYXBpX21ha2VyLXN0eWxlLiBQb2xpY3kgb3B0aW9uc1xuICAgKiAoYWxsb3dEZXN0cm95LCBsaW1pdCwgcmVqZWN0SWYpIGNvbWUgZnJvbSB0aGUgTU9ERUwnc1xuICAgKiBgYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUpYCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IG5lc3RlZEF0dHJpYnV0ZXMgLSBOZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGwgfCB1bmRlZmluZWR9IGNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciByZXNvdXJjZSByZXNvbHV0aW9uIGFuZCBhdXRob3JpemF0aW9uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwgbnVsbH0gW3BhcmVudFBlcm1pdF0gLSBQYXJzZWQgcGFyZW50IHBlcm1pdCBzcGVjLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcHBseU5lc3RlZEF0dHJpYnV0ZXMocGFyZW50LCBuZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBwYXJlbnRQZXJtaXQgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRQYXJlbnQgPSBwYXJlbnRQZXJtaXRcbiAgICAgIHx8IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwidXBkYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiB7fX0pKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBjaGlsZFBlcm1pdCA9IHJlc29sdmVkUGFyZW50Lm5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIWNoaWxkUGVybWl0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9JyBhcmUgbm90IHBlcm1pdHRlZCBieSAke3RoaXMuY29uc3RydWN0b3IubmFtZX0ucGVybWl0dGVkUGFyYW1zKCkuIEluY2x1ZGUgeyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzOiBbLi4uXX0gaW4gdGhlIHJldHVybmVkIHBlcm1pdC5gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7XG4gICAgICAgIGNoaWxkUGVybWl0LFxuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJhd0VudHJpZXM6IG5lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV0sXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb250ZXh0LnJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHBhcmVudExpbmtBdHRyaWJ1dGVzID0gdGhpcy5fcGFyZW50TGlua0F0dHJpYnV0ZXNGb3JOZXN0ZWRDaGlsZCh7XG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmVsYXRpb25zaGlwOiBjb250ZXh0LnJlbGF0aW9uc2hpcCxcbiAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBkZXN0cm95RW50cmllcyA9IFtdXG4gICAgICBjb25zdCB1cGRhdGVFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IGNyZWF0ZUVudHJpZXMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRleHQuZW50cmllcykge1xuICAgICAgICBpZiAoZW50cnk/Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWVudHJ5LmlkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGRlc3Ryb3lFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSBpZiAoZW50cnk/LmlkKSB7XG4gICAgICAgICAgdXBkYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNyZWF0ZUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGRlc3Ryb3lFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcblxuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgICAgIGNoaWxkUHJpbWFyeUtleTogY29udGV4dC5jaGlsZFByaW1hcnlLZXksXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLmRlc3Ryb3koZXhpc3RpbmcpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdXBkYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIHVwZGF0ZSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIGlkLFxuICAgICAgICAgIHBhcmVudCxcbiAgICAgICAgICBwYXJlbnRMaW5rQXR0cmlidXRlcyxcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtcbiAgICAgICAgICBjaGlsZDogZXhpc3RpbmcsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoZXhpc3RpbmcsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBleGlzdGluZy5zYXZlKClcblxuICAgICAgICBpZiAoZW50cnkubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNyZWF0ZUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSBuZXcgY29udGV4dC50YXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBjaGlsZC5hc3NpZ24ocGFyZW50TGlua0F0dHJpYnV0ZXMpXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogY29udGV4dC5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgICAgICBlbnRyeVxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcyB8fCB7fSwgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIGF3YWl0IGNoaWxkLnNhdmUoKVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2F1dGhvcml6ZUNyZWF0ZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgIGNoaWxkUHJpbWFyeUtleTogY29udGV4dC5jaGlsZFByaW1hcnlLZXksXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoZW50cnkubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIG9uZSBuZXN0ZWQgZW50cnkncyBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cyB0byBhIGNoaWxkIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFzc2lnbm1lbnQgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNoaWxkIC0gQ2hpbGQgbW9kZWwgcmVjZWl2aW5nIGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgY2hpbGQgYXR0cmlidXRlIGFuZCBhdHRhY2htZW50IG5hbWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5lbnRyeSAtIE5lc3RlZCBlbnRyeSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe2NoaWxkLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcywgZW50cnl9KSB7XG4gICAgaWYgKGVudHJ5LmF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5LmF0dHJpYnV0ZXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBuZXN0ZWQgZW50cnkgYXR0cmlidXRlcyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhjaGlsZCwgY2hpbGQuZ2V0TW9kZWxDbGFzcygpLCBlbnRyeS5hdHRyaWJ1dGVzLCB0aGlzLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcylcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhjaGlsZCwgZmlsdGVyZWQpXG4gICAgfVxuXG4gICAgaWYgKGVudHJ5LmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQgJiYgIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBuZXN0ZWQgZW50cnkgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIHRoaXMuX2Fzc2lnbkF0dGFjaG1lbnRzKGNoaWxkLCBlbnRyeS5hdHRhY2htZW50cyA/PyBudWxsLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHJlbGF0aW9uc2hpcCdzIGZvcmVpZ24ta2V5IGNvbHVtbi9uYW1lIHRvIHRoZSB0YXJnZXQgbW9kZWwncyBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBjb250YWluaW5nIHRoZSBGSy5cbiAgICogQHJldHVybnMge3N0cmluZ30gRm9yZWlnbi1rZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgbW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV0gfHwgZm9yZWlnbktleVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIEZLIGF0dHJpYnV0ZXMgdGhhdCBiaW5kIGEgbmVzdGVkIGNoaWxkIHRvIGl0cyBwYXJlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFyZW50LWxpbmsgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqL1xuICBfcGFyZW50TGlua0F0dHJpYnV0ZXNGb3JOZXN0ZWRDaGlsZCh7cGFyZW50LCByZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7W2ZvcmVpZ25LZXldOiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShwYXJlbnQuaWQoKSwgYE5lc3RlZCBjaGlsZCB3cml0ZSBmb3IgJHtwYXJlbnQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCl9XG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkpIHtcbiAgICAgIGNvbnN0IHR5cGVBdHRyaWJ1dGUgPSB0aGlzLl9wb2x5bW9ycGhpY1R5cGVBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgIGF0dHJpYnV0ZXNbdHlwZUF0dHJpYnV0ZV0gPSBwYXJlbnQuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHJlbGF0aW9uc2hpcCdzIHBvbHltb3JwaGljIHR5cGUgY29sdW1uL25hbWUgdG8gYSBjaGlsZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBjb250YWluaW5nIHRoZSB0eXBlIGNvbHVtbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gUG9seW1vcnBoaWMgdHlwZSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIF9wb2x5bW9ycGhpY1R5cGVBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCB0eXBlQ29sdW1uID0gcmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljVHlwZUNvbHVtbigpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbdHlwZUNvbHVtbl0gfHwgdHlwZUNvbHVtblxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFuIGF1dGhvcml6ZWQgbmVzdGVkIHJlY29yZCBieSBpZCB3aXRob3V0IHBhcmVudCBzY29waW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvb2t1cCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MuY2hpbGRQcmltYXJ5S2V5IC0gUmVzb2x2ZWQgY2hpbGQgcmVzb3VyY2UgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQXV0aG9yaXplZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kTmVzdGVkUmVjb3JkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUHJpbWFyeUtleSwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGlkLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyB0YXJnZXRNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5fcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSwgYWJpbGl0eSlcbiAgICAgIDogdGFyZ2V0TW9kZWxDbGFzcy53aGVyZSh7fSlcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKGNoaWxkUHJpbWFyeUtleSwgaWQpKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgJHthY3Rpb259IG5lc3RlZCAke3JlbGF0aW9uc2hpcE5hbWV9W2lkPSR7aWR9XTogcmVjb3JkIG5vdCBmb3VuZCBvciBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cblxuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhYmlsaXR5IGFjdGlvbiBmb3IgYSBjaGlsZCByZXNvdXJjZSB1c2luZyB0aGUgY2hpbGQncyBvd25cbiAgICogYGFiaWxpdGllc2AgbWFwcGluZyDigJQgbmV2ZXIgdGhlIHBhcmVudCBjb250cm9sbGVyJ3MuIFRoaXMgcHJlc2VydmVzXG4gICAqIGN1c3RvbSBtYXBwaW5ncyBsaWtlIGB7dXBkYXRlOiBcIm1hbmFnZVwifWAgYW5kIGNhdGNoZXMgdW5tYXBwZWQgYWN0aW9uc1xuICAgKiBpbnN0ZWFkIG9mIHNpbGVudGx5IGRlZmF1bHRpbmcgdG8gdGhlIHJhdyBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFiaWxpdHkgYWN0aW9uIGZvciB0aGUgY2hpbGQgcmVzb3VyY2UuXG4gICAqL1xuICBfcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24/LmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFuICdhYmlsaXRpZXMnIG9iamVjdCB0byBhdXRob3JpemUgbmVzdGVkICR7YWN0aW9ufS5gKVxuICAgIH1cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFiaWxpdGllcy4ke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICByZXR1cm4gYWJpbGl0eUFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFuIGV4aXN0aW5nIGNoaWxkIGZvciBhIG5lc3RlZCB1cGRhdGUvZGVzdHJveSwgc2NvcGVkIHRvIHRoZVxuICAgKiBjaGlsZCdzIG93biBtb2RlbCBjbGFzcywgdGhlIHBhcmVudCdzIGZvcmVpZ24ga2V5LCBBTkQgdGhlIGNoaWxkXG4gICAqIHJlc291cmNlJ3MgYWJpbGl0eSBtYXBwaW5nIGZvciB0aGUgcmVxdWVzdGVkIGFjdGlvbi4gVGhyb3dzIHdoZW4gdGhlXG4gICAqIGNoaWxkIGRvZXMgbm90IGV4aXN0LCBkb2VzIG5vdCBiZWxvbmcgdG8gdGhlIGN1cnJlbnQgcGFyZW50LCBvciBpc1xuICAgKiBub3QgYXV0aG9yaXplZCDigJQgYWxsIG9mIHdoaWNoIG11c3Qgcm9sbCB0aGUgdHJhbnNhY3Rpb24gYmFjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MuY2hpbGRQcmltYXJ5S2V5IC0gUmVzb2x2ZWQgY2hpbGQgcmVzb3VyY2UgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBhcmdzLnBhcmVudExpbmtBdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0aGF0IHNjb3BlIHRoZSBjaGlsZCB0byB0aGUgcGFyZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgKGZvciBlcnJvciBtZXNzYWdlcykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQsIHBhcmVudC1saW5rZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZFNjb3BlZENoaWxkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUHJpbWFyeUtleSwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGlkLCBwYXJlbnQsIHBhcmVudExpbmtBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGlkZW50aXR5Q29uZGl0aW9ucyA9IG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMoY2hpbGRQcmltYXJ5S2V5LCBpZClcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHBhcmVudFZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwYXJlbnRMaW5rQXR0cmlidXRlcykpIHtcbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaWRlbnRpdHlDb25kaXRpb25zLCBhdHRyaWJ1dGVOYW1lKSAmJiBpZGVudGl0eUNvbmRpdGlvbnNbYXR0cmlidXRlTmFtZV0gIT09IHBhcmVudFZhbHVlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90ICR7YWN0aW9ufSBuZXN0ZWQgJHtyZWxhdGlvbnNoaXBOYW1lfVtpZD0ke2lkfV06IGlkZW50aXR5IGZpZWxkICcke2F0dHJpYnV0ZU5hbWV9JyBkb2VzIG5vdCBtYXRjaCBwYXJlbnQgJHtwYXJlbnQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9W2lkPSR7cGFyZW50LmlkKCl9XS5gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGxvb2t1cCA9IHsuLi5pZGVudGl0eUNvbmRpdGlvbnMsIC4uLnBhcmVudExpbmtBdHRyaWJ1dGVzfVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyB0YXJnZXRNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5fcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSwgYWJpbGl0eSlcbiAgICAgIDogdGFyZ2V0TW9kZWxDbGFzcy53aGVyZSh7fSlcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcXVlcnkuZmluZEJ5KGxvb2t1cClcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90ICR7YWN0aW9ufSBuZXN0ZWQgJHtyZWxhdGlvbnNoaXBOYW1lfVtpZD0ke2lkfV06IHJlY29yZCBub3QgZm91bmQsIGRvZXMgbm90IGJlbG9uZyB0byBwYXJlbnQgJHtwYXJlbnQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9W2lkPSR7cGFyZW50LmlkKCl9XSwgb3IgaXMgbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG5cbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyBhbiBhbHJlYWR5LXNhdmVkIG5lc3RlZCBjaGlsZCBpcyBhdXRob3JpemVkIHVuZGVyIHRoZSBjaGlsZFxuICAgKiByZXNvdXJjZSdzIG93biBgY3JlYXRlYCBhYmlsaXR5LiBSb2xscyBiYWNrIHZpYSB0aHJvd24gZXJyb3Igd2hlbiBub3RcbiAgICogYXV0aG9yaXplZCBzbyB0aGUgb3V0ZXIgdHJhbnNhY3Rpb24gZGVzdHJveXMgdGhlIGluc2VydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5jaGlsZCAtIENoaWxkIG1vZGVsIGluc3RhbmNlIGp1c3QgY3JlYXRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLmNoaWxkUHJpbWFyeUtleSAtIFJlc29sdmVkIGNoaWxkIHJlc291cmNlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgKGZvciBlcnJvciBtZXNzYWdlcykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXV0aG9yaXplQ3JlYXRlZENoaWxkKHthYmlsaXR5LCBjaGlsZCwgY2hpbGRQcmltYXJ5S2V5LCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIWFiaWxpdHkpIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgaWRlbnRpdHkgPSByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUoY2hpbGRQcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gY2hpbGQucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgICBjb25zdCBhdXRob3JpemVkQ2hpbGQgPSBhd2FpdCB0YXJnZXRNb2RlbENsYXNzXG4gICAgICAuYWNjZXNzaWJsZUZvcihhYmlsaXR5QWN0aW9uLCBhYmlsaXR5KVxuICAgICAgLmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKGNoaWxkUHJpbWFyeUtleSwgaWRlbnRpdHkpKVxuXG4gICAgaWYgKCFhdXRob3JpemVkQ2hpbGQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNyZWF0ZSBvbiAke3JlbGF0aW9uc2hpcE5hbWV9WyR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfV0gbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWZ0ZXIgbmVzdGVkIHdyaXRlcywgcHJlbG9hZCBldmVyeSByZWxhdGlvbnNoaXAgZGVjbGFyZWQgaW4gdGhlXG4gICAqIHBhcmVudCdzIHBlcm1pdCBzbyB0aGUgcG9zdC1zYXZlIHNlcmlhbGl6ZSBzdGVwIGVtaXRzIHRoZW0gYW5kIHRoZVxuICAgKiBjbGllbnQgY2FuIHJlY29uY2lsZSBpZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gU2F2ZWQgcGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBwZXJtaXQgLSBQYXJzZWQgcGFyZW50IHBlcm1pdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcHJlbG9hZE5lc3RlZFdyaXRhYmxlUmVsYXRpb25zaGlwcyhtb2RlbCwgcGVybWl0KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZXMgPSBPYmplY3Qua2V5cyhwZXJtaXQubmVzdGVkKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcE5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcmVsYXRpb25zaGlwTmFtZXMpIHtcbiAgICAgIGF3YWl0IG1vZGVsLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBQYXJzZXMgdGhlIFJhaWxzL2FwaV9tYWtlci1zdHlsZSBmbGF0IHBlcm1pdCBzcGVjIHJldHVybmVkIGZyb21cbiAqIGBwZXJtaXR0ZWRQYXJhbXMoYXJnKWAgaW50byBhIHN0cnVjdHVyZWQgc2hhcGUgdXNlZCBpbnRlcm5hbGx5IGJ5IHRoZVxuICogd3JpdGUgcGlwZWxpbmUuIFN0cmluZ3MgYmVjb21lIGF0dHJpYnV0ZSBwZXJtaXRzOyBvYmplY3RzIHdob3NlIGtleXNcbiAqIGVuZCBpbiBgQXR0cmlidXRlc2AgYmVjb21lIG5lc3RlZCBwZXJtaXRzICh0aGUga2V5IHByZWZpeCBuYW1lcyB0aGVcbiAqIHJlbGF0aW9uc2hpcCkuXG4gKlxuICogICBwYXJzZVBlcm1pdHRlZFBhcmFtcyhbXCJmaXJzdE5hbWVcIiwgXCJsYXN0TmFtZVwiLFxuICogICAgIHt0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdfVxuICogICBdKVxuICogICAvLyDihpIge1xuICogICAvLyAgIGF0dHJpYnV0ZXM6IFtcImZpcnN0TmFtZVwiLCBcImxhc3ROYW1lXCJdLFxuICogICAvLyAgIG5lc3RlZDoge1xuICogICAvLyAgICAgdGFza3M6IHthdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXSwgbmVzdGVkOiB7fX1cbiAqICAgLy8gICB9XG4gKiAgIC8vIH1cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PiB8IHVuZGVmaW5lZH0gcGVybWl0U3BlYyAtIEZsYXQgcGVybWl0IHNwZWMuXG4gKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn19IC0gUGFyc2VkIHN0cnVjdHVyZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VQZXJtaXR0ZWRQYXJhbXMocGVybWl0U3BlYykge1xuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBhdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59ICovXG4gIGNvbnN0IG5lc3RlZCA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KHBlcm1pdFNwZWMpKSByZXR1cm4ge2F0dHJpYnV0ZXMsIG5lc3RlZH1cblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBlcm1pdFNwZWMpIHtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBhdHRyaWJ1dGVzLnB1c2goZW50cnkpXG4gICAgfSBlbHNlIGlmIChlbnRyeSAmJiB0eXBlb2YgZW50cnkgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZW50cnkpKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhlbnRyeSkpIHtcbiAgICAgICAgaWYgKCFrZXkuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogbmVzdGVkIHJlbGF0aW9uc2hpcCBrZXlzIG11c3QgZW5kIGluIFwiQXR0cmlidXRlc1wiIChnb3QgXCIke2tleX1cIikuIFVzZSBcIiR7a2V5fUF0dHJpYnV0ZXNcIiBpbnN0ZWFkLmApXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGtleS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuXG4gICAgICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IGVtcHR5IHJlbGF0aW9uc2hpcCBuYW1lIGluIGtleSBcIiR7a2V5fVwiLmApXG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnkgZm9yIFwiJHtrZXl9XCI6IGV4cGVjdGVkIGFycmF5IHBlcm1pdCBzcGVjLCBnb3QgJHt0eXBlb2YgdmFsdWV9LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRbcmVsYXRpb25zaGlwTmFtZV0gPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogZXhwZWN0ZWQgc3RyaW5nIG9yIG5lc3RlZC1hdHRyaWJ1dGVzIG9iamVjdCwgZ290ICR7dHlwZW9mIGVudHJ5fS5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7YXR0cmlidXRlcywgbmVzdGVkfVxufVxuXG4vKipcbiAqIExvY2F0ZXMgd2hpY2ggcHJvdG90eXBlIG93bnMgYSBtZXRob2QgaW1wbGVtZW50YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gaW5zdGFuY2UgLSBJbnN0YW5jZSByZWNlaXZpbmcgdGhlIG1ldGhvZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gKiBAcmV0dXJucyB7b2JqZWN0IHwgbnVsbH0gLSBQcm90b3R5cGUgdGhhdCBvd25zIHRoZSBtZXRob2QuXG4gKi9cbmZ1bmN0aW9uIHByb3RvdHlwZU93bmVyRm9yTWV0aG9kKGluc3RhbmNlLCBtZXRob2ROYW1lKSB7XG4gIGxldCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoaW5zdGFuY2UpXG5cbiAgd2hpbGUgKHByb3RvdHlwZSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocHJvdG90eXBlLCBtZXRob2ROYW1lKSkgcmV0dXJuIHByb3RvdHlwZVxuXG4gICAgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHByb3RvdHlwZSlcbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyBmaWx0ZXIgd3JpdGFibGUgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gUmVzb3VyY2VNb2RlbENsYXNzXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gUmVzb3VyY2VEYXRhYmFzZU1vZGVsQ2xhc3NcbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZWNlaXZlciAtIE1vZGVsIGluc3RhbmNlIG9yIHByb3RvdHlwZS5cbiAqIEBwYXJhbSB7V3JpdGFibGVBdHRyaWJ1dGVSZWNlaXZlckNsYXNzfSByZWNlaXZlckNsYXNzIC0gU3RhdGljIGhlbHBlciBvd25lciBmb3IgdGhlIHJlY2VpdmVyLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFJlc291cmNlTW9kZWxDbGFzcywgUmVzb3VyY2VEYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbH0gW3Jlc291cmNlXSAtIFJlc291cmNlIGluc3RhbmNlIGZvciB2aXJ0dWFsLXNldHRlciBkZXRlY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgbnVsbH0gW3Blcm1pdHRlZEF0dHJpYnV0ZU5hbWVzXSAtIE9wdGlvbmFsIGV4cGxpY2l0IHBlcm1pdCBsaXN0LiBgbnVsbGAgZmFsbHMgYmFjayB0byBzZXR0ZXItZXhpc3RlbmNlIGNoZWNrcyBvbmx5LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXcml0YWJsZSBhdHRyaWJ1dGVzIG9ubHkuXG4gKi9cbmZ1bmN0aW9uIGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoXG4gIHJlY2VpdmVyLFxuICByZWNlaXZlckNsYXNzLFxuICBhdHRyaWJ1dGVzLFxuICByZXNvdXJjZSA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxSZXNvdXJjZU1vZGVsQ2xhc3MsIFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9ICovIChudWxsKSxcbiAgcGVybWl0dGVkQXR0cmlidXRlTmFtZXMgPSBudWxsXG4pIHtcbiAgLy8gRnJvbnRlbmQtbW9kZWwgd3JpdGVzIHNob3VsZCBmYWlsIGZhc3Qgd2hlbiBjYWxsZXJzIHN1Ym1pdCByZWFkLW9ubHkgb3IgdW5rbm93biBhdHRycy5cbiAgLy8gU2lsZW50IGRyb3BzIGhpZGUgY29udHJhY3QgbWlzdGFrZXMgaW4gZ2VuZXJhdGVkIG1vZGVscyBhbmQgYXBwLXNpZGUgd3JhcHBlciBjb2RlLlxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3Qgd3JpdGFibGVBdHRyaWJ1dGVzID0ge31cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzID0gW11cblxuICBjb25zdCBwZXJtaXRTZXQgPSBBcnJheS5pc0FycmF5KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSA/IG5ldyBTZXQocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpIDogbnVsbFxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBsZXQgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSBbXVxuXG4gIGlmIChyZXNvdXJjZSkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAocmVzb3VyY2UuY29uc3RydWN0b3IpXG5cbiAgICB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IFJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXVxuICB9XG5cbiAgY29uc3QgdHJhbnNsYXRlZFNldCA9IG5ldyBTZXQodHJhbnNsYXRlZEF0dHJpYnV0ZXMpXG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgaWYgKHBlcm1pdFNldCAmJiAhcGVybWl0U2V0LmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgbm90UGVybWl0dGVkQXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHJlY2VpdmVyQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkgfHwgYXR0cmlidXRlTmFtZVxuICAgIGNvbnN0IHJlcXVlc3RlZFNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlc29sdmVkQXR0cmlidXRlTmFtZSl9YFxuICAgIGNvbnN0IHNldHRlck5hbWUgPSByZWNlaXZlckNsYXNzLmZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUocmVjZWl2ZXIsIHJlcXVlc3RlZFNldHRlck5hbWUpIHx8IHJlcXVlc3RlZFNldHRlck5hbWVcbiAgICBjb25zdCByZXNvdXJjZVNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZU5hbWUpfUF0dHJpYnV0ZWBcbiAgICBjb25zdCByZXNvdXJjZVNldHRlciA9IHJlc291cmNlPy5yZXNvdXJjZU1ldGhvZChyZXNvdXJjZVNldHRlck5hbWUpXG5cbiAgICBpZiAoc2V0dGVyTmFtZSBpbiByZWNlaXZlcikge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2UgaWYgKHJlc291cmNlU2V0dGVyKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGludmFsaWRBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gIH1cblxuICBpZiAobm90UGVybWl0dGVkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgRnJvbnRlbmQgbW9kZWwgd3JpdGUgYXR0cmlidXRlcyBub3QgcGVybWl0dGVkIGJ5IHBlcm1pdHRlZFBhcmFtcygpOiAke25vdFBlcm1pdHRlZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgfVxuXG4gIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgSW52YWxpZCBmcm9udGVuZCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gIH1cblxuICByZXR1cm4gd3JpdGFibGVBdHRyaWJ1dGVzXG59XG5cbi8qKlxuICogUGFyc2VzIGEgdHJpbW1lZCBxdWljay1zZWFyY2ggdmFsdWUgYXMgYSBzYWZlIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IHNlYXJjaFZhbHVlIC0gVHJpbW1lZCBxdWljay1zZWFyY2ggdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOdW1lcmljIHNlYXJjaCB2YWx1ZSwgb3IgbnVsbCB3aGVuIG5vdCBudW1lcmljLlxuICovXG5mdW5jdGlvbiBxdWlja1NlYXJjaE51bWVyaWNWYWx1ZShzZWFyY2hWYWx1ZSkge1xuICBpZiAoIS9eWzAtOV0rJC91LnRlc3Qoc2VhcmNoVmFsdWUpKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IG51bWVyaWNWYWx1ZSA9IE51bWJlci5wYXJzZUludChzZWFyY2hWYWx1ZSwgMTApXG5cbiAgcmV0dXJuIE51bWJlci5pc1NhZmVJbnRlZ2VyKG51bWVyaWNWYWx1ZSkgPyBudW1lcmljVmFsdWUgOiBudWxsXG59XG4iXX0=