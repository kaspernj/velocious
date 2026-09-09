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
     * @param {"abilities" | "attachments" | "attributes" | "builtInCollectionCommands" | "builtInMemberCommands" | "collectionCommands" | "commands" | "memberCommands" | "modelName" | "primaryKey" | "relationships" | "server" | "sync" | "translatedAttributes" | "writableAttributes"} name - Static config property name.
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
        return await query.findBy(modelPrimaryKeyConditions(this.primaryKey(), mutation.resourceId));
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
     * Applies frontend-model index search.
     * @param {object} args - Search args.
     * @param {FrontendModelResourceController} args.controller - Controller handling the query.
     * @param {FrontendModelResourceAnyQuery} args.query - Query instance.
     * @param {FrontendModelResourceSearch} args.search - Search params.
     * @returns {void}
     */
    applyFrontendModelIndexSearch({ controller, query, search }) {
        controller.applyFrontendModelSearch({ query, search });
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
        return await query.findBy(modelPrimaryKeyConditions(this.primaryKey(), id));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sRUFBQyx5QkFBeUIsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQzdILE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7O0dBSUc7QUFFSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7Ozs7O0dBU0c7QUFFSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFDSCxNQUFNLFVBQVUsd0NBQXdDLENBQUMsYUFBYTtJQUNwRSxPQUFPLG1LQUFtSyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQTtBQUNyTixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQTBCLFNBQVEseUJBQXlCO0lBQzlFLDBEQUEwRDtJQUMxRCxNQUFNLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtJQUU3QixtRkFBbUY7SUFDbkYsTUFBTSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7SUFDN0IsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO0lBQzVCLG1IQUFtSDtJQUNuSCxNQUFNLENBQUMsV0FBVyxHQUFHLFNBQVMsQ0FBQTtJQUM5QixtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUE7SUFDM0IsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7SUFDckMsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyx5QkFBeUIsR0FBRyxTQUFTLENBQUE7SUFDNUMsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO0lBQ2pDLG1DQUFtQztJQUNuQyxNQUFNLENBQUMscUJBQXFCLEdBQUcsU0FBUyxDQUFBO0lBQ3hDLG1DQUFtQztJQUNuQyxNQUFNLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQTtJQUNoQyxpQ0FBaUM7SUFDakMsTUFBTSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsNENBQTRDO0lBQzVDLE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBQzdCLHVHQUF1RztJQUN2RyxNQUFNLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtJQUN6QiwrR0FBK0c7SUFDL0csTUFBTSxDQUFDLElBQUksR0FBRyxTQUFTLENBQUE7SUFDdkIsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxvQkFBb0IsR0FBRyxTQUFTLENBQUE7SUFDdkMsNENBQTRDO0lBQzVDLE1BQU0sQ0FBQyxjQUFjLEdBQUcsU0FBUyxDQUFBO0lBRWpDOzs7Ozs7OzZDQU95QztJQUN6QyxNQUFNLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO0lBRXJDOzs7T0FHRztJQUNILFlBQVksSUFBSTtRQUNkLEtBQUssQ0FBQztZQUNKLE9BQU8sRUFBRSxTQUFTLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ3JELE9BQU8sRUFBRSxTQUFTLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNwRCxNQUFNLEVBQUUsUUFBUSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUU7U0FDbEQsQ0FBQyxDQUFBO1FBRUYsd0ZBQXdGO1FBQ3hGLE1BQU0sYUFBYSxHQUFHLHNIQUFzSCxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQy9KLE1BQU0sNEJBQTRCLEdBQUcscUZBQXFGLENBQUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxFQUFFLEVBQUMsQ0FBQyxDQUFBO1FBRTdJLElBQUksQ0FBQyxVQUFVLEdBQUcsWUFBWSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ3BFLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxlQUFlLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7UUFDbEYsOEdBQThHO1FBQzlHLElBQUksQ0FBQyxlQUFlLEdBQUcsMEJBQTBCLENBQUMsQ0FBQyxZQUFZLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUN2SCxJQUFJLENBQUMsY0FBYyxHQUFHLFdBQVcsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtRQUM3RixJQUFJLENBQUMsV0FBVyxHQUFHLFFBQVEsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUM3RCxJQUFJLENBQUMsMEJBQTBCLEdBQUcsdUJBQXVCLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLDRCQUE0QixDQUFBO1FBQzdILDZGQUE2RjtRQUM3RixJQUFJLENBQUMsMkJBQTJCLEdBQUcsU0FBUyxDQUFBO0lBQzlDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsbUJBQW1CO1FBQ3hCLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMseUJBQXlCLENBQUMsSUFBSTtRQUNuQyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFL0MsTUFBTSxjQUFjLEdBQUcsMkRBQTJELENBQUMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxDQUFBO1FBRS9HLElBQUksQ0FBQyxjQUFjO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFDckMsSUFBSSxjQUFjLENBQUMsSUFBSSxDQUFDLEtBQUssU0FBUztZQUFFLE9BQU8sY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRW5FLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsMEJBQTBCO1FBQy9CLE9BQU8sbUNBQW1DLENBQUMsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFBO0lBQ3JHLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLHdCQUF3QjtRQUM3QixNQUFNLHFCQUFxQixHQUFHLG1IQUFtSCxDQUFDLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUE7UUFDak0sTUFBTSxXQUFXLEdBQUcscUJBQXFCLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxxQkFBcUIsRUFBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUE7UUFFM0UsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVO1lBQUUsT0FBTyxXQUFXLENBQUE7UUFFeEMsS0FBSyxNQUFNLENBQUMsY0FBYyxFQUFFLFVBQVUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUNuRyxNQUFNLGdCQUFnQixHQUFHLHVGQUF1RixDQUFDLENBQUMsRUFBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLElBQUksRUFBQyxDQUFDLENBQUE7WUFFMUksSUFBSSxVQUFVLENBQUMsSUFBSTtnQkFBRSxnQkFBZ0IsQ0FBQyxJQUFJLEdBQUcsRUFBQyxHQUFHLFVBQVUsQ0FBQyxJQUFJLEVBQUMsQ0FBQTtZQUVqRSxXQUFXLENBQUMsY0FBYyxDQUFDLEdBQUcsZ0JBQWdCLENBQUE7UUFDaEQsQ0FBQztRQUVELE9BQU8sV0FBVyxDQUFBO0lBQ3BCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxzQkFBc0I7UUFDcEIsSUFBSSxJQUFJLENBQUMsMkJBQTJCLEtBQUssU0FBUztZQUFFLE9BQU8sSUFBSSxDQUFDLDJCQUEyQixDQUFBO1FBRTNGLE1BQU0sYUFBYSxHQUFHLG1IQUFtSCxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzVKLE1BQU0sY0FBYyxHQUFHLCtIQUErSCxDQUFDLENBQUMsYUFBYSxDQUFDLG1CQUFtQixFQUFFLENBQUMsQ0FBQTtRQUU1TCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLDJCQUEyQixHQUFHLElBQUksQ0FBQTtZQUN2QyxPQUFPLElBQUksQ0FBQywyQkFBMkIsQ0FBQTtRQUN6QyxDQUFDO1FBRUQsSUFBSSxjQUFjLEtBQUssYUFBYSxFQUFFLENBQUM7WUFDckMsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLGFBQWEsQ0FBQyxJQUFJLHlDQUF5QyxDQUFDLENBQUE7UUFDakYsQ0FBQztRQUVELE1BQU0seUJBQXlCLEdBQUcseUZBQXlGLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFBO1FBQ3JLLE1BQU0sY0FBYyxHQUFHLElBQUkseUJBQXlCLENBQUM7WUFDbkQsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUMzQixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ25CLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVSxFQUFFO1lBQzdCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFO1lBQzNCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3JCLHFCQUFxQixFQUFFLElBQUksQ0FBQyxxQkFBcUIsRUFBRTtTQUNwRCxDQUFDLENBQUE7UUFDRixJQUFJLENBQUMsMkJBQTJCLEdBQUcsY0FBYyxDQUFBO1FBRWpELE9BQU8sY0FBYyxDQUFBO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHdCQUF3QixDQUFDLFVBQVUsRUFBRSxJQUFJO1FBQ3ZDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBRXBELElBQUksQ0FBQyxjQUFjO1lBQUUsT0FBTyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBQyxDQUFBO1FBRTlELE1BQU0sV0FBVyxHQUFHLHVCQUF1QixDQUFDLGNBQWMsRUFBRSxVQUFVLENBQUMsQ0FBQTtRQUV2RSxJQUFJLENBQUMsV0FBVyxJQUFJLFdBQVcsS0FBSyx5QkFBeUIsQ0FBQyxTQUFTLElBQUksV0FBVyxLQUFLLHlCQUF5QixDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQy9ILE9BQU8sRUFBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUMsQ0FBQTtRQUMzQyxDQUFDO1FBRUQsTUFBTSxNQUFNLEdBQUcsb0VBQW9FLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXpJLE9BQU8sRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsRUFBQyxDQUFBO0lBQ25FLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsc0JBQXNCLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxRQUFRO1FBQy9DLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFFcEUsSUFBSSxZQUFZLENBQUMsTUFBTTtZQUFFLE9BQU8scUJBQXFCLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFM0UsT0FBTyxRQUFRLEVBQUUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxVQUFVO1FBQ3ZCLE1BQU0sU0FBUyxHQUFHLHNDQUFzQyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVwRyxJQUFJLE9BQU8sU0FBUyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3BDLE9BQU87Z0JBQ0wsTUFBTSxFQUFFLG9EQUFvRCxDQUFDLENBQUMsU0FBUyxDQUFDO2dCQUN4RSxRQUFRLEVBQUUsSUFBSTthQUNmLENBQUE7UUFDSCxDQUFDO1FBRUQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFFcEQsSUFBSSxDQUFDLGNBQWM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVoQyxNQUFNLFlBQVksR0FBRyxzQ0FBc0MsQ0FBQyxFQUFDLHNCQUF1QixDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFakgsSUFBSSxPQUFPLFlBQVksS0FBSyxVQUFVO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFbkQsT0FBTztZQUNMLE1BQU0sRUFBRSxvREFBb0QsQ0FBQyxDQUFDLFlBQVksQ0FBQztZQUMzRSxRQUFRLEVBQUUsY0FBYztTQUN6QixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILFNBQVM7UUFDUCxJQUFJLENBQUMsc0JBQXNCLENBQUMsV0FBVyxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUMvRCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsdUJBQXVCO1FBQ3JCLE9BQU8sOENBQThDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDekUsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxjQUFjO1FBQ25CLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUMvRCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDN0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixFQUFFLENBQUE7UUFDbkQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzNELE1BQU0seUJBQXlCLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLDJCQUEyQixDQUFDLENBQUE7UUFDN0YsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtRQUNyRixNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO1FBQy9FLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ3ZFLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUM3RCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsWUFBWSxDQUFDLENBQUE7UUFDL0QsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLGVBQWUsQ0FBQyxDQUFBO1FBQ3JFLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUN2RCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDbkQscUZBQXFGO1FBQ3JGLE1BQU0sTUFBTSxHQUFHO1lBQ2IsVUFBVSxFQUFFLHVFQUF1RSxDQUFDLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQztTQUN2RyxDQUFBO1FBRUQsSUFBSSxTQUFTO1lBQUUsTUFBTSxDQUFDLFNBQVMsR0FBRyx1QkFBdUIsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3JFLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE1BQU0sQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQ3pFLElBQUksUUFBUTtZQUFFLE1BQU0sQ0FBQyxRQUFRLEdBQUcsdUJBQXVCLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUNsRSxJQUFJLHlCQUF5QjtZQUFFLE1BQU0sQ0FBQyx5QkFBeUIsR0FBRyx1QkFBdUIsQ0FBQyxDQUFDLHlCQUF5QixDQUFDLENBQUE7UUFDckgsSUFBSSxxQkFBcUI7WUFBRSxNQUFNLENBQUMscUJBQXFCLEdBQUcsdUJBQXVCLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFBO1FBQ3pHLElBQUksa0JBQWtCO1lBQUUsTUFBTSxDQUFDLGtCQUFrQixHQUFHLHVCQUF1QixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUNoRyxJQUFJLGNBQWM7WUFBRSxNQUFNLENBQUMsY0FBYyxHQUFHLHVCQUF1QixDQUFDLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDcEYsSUFBSSxTQUFTO1lBQUUsTUFBTSxDQUFDLFNBQVMsR0FBRyxxQkFBcUIsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ25FLElBQUksVUFBVTtZQUFFLE1BQU0sQ0FBQyxVQUFVLEdBQUcsZ0NBQWdDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUNqRixJQUFJLGFBQWE7WUFBRSxNQUFNLENBQUMsYUFBYSxHQUFHLHVCQUF1QixDQUFDLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDakYsSUFBSSxNQUFNO1lBQUUsTUFBTSxDQUFDLE1BQU0sR0FBRywyRkFBMkYsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ2hJLElBQUksSUFBSSxLQUFLLFNBQVM7WUFBRSxNQUFNLENBQUMsSUFBSSxHQUFHLG1HQUFtRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFaEosT0FBTyxNQUFNLENBQUE7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxxQkFBcUI7UUFDN0MsSUFBSSxxQkFBcUIsQ0FBQyxVQUFVO1lBQUUsT0FBTyxxQkFBcUIsQ0FBQyxVQUFVLENBQUE7UUFDN0UsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFakMsTUFBTSxVQUFVLEdBQUcsbUVBQW1FLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUMxRyxNQUFNLGVBQWUsR0FBRyxVQUFVLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFL0MsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQztZQUNuQyxDQUFDLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxJQUFJLFVBQVUsQ0FBQztZQUNoRyxDQUFDLENBQUMsVUFBVSxDQUFDLG9CQUFvQixDQUFDLGVBQWUsQ0FBQyxJQUFJLGVBQWUsQ0FBQTtJQUN6RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0JBQWtCO1FBQ2hCLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksa0NBQWtDLENBQUMsQ0FBQTtRQUVqRyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsYUFBYTtRQUNYLElBQUksSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDeEUsSUFBSSxJQUFJLENBQUMsa0JBQWtCO1lBQUUsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7UUFFM0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxzREFBc0QsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLDBCQUEwQixDQUFDLENBQUE7UUFDckUsQ0FBQztRQUVELE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0JBQWtCO1FBQ2hCLG9GQUFvRjtRQUNwRixPQUFPLGtDQUFrQyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQTtJQUN4RixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0JBQWtCO1FBQ2hCLE9BQU8sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFBO0lBQzFCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxTQUFTO1FBQ1AsSUFBSSxDQUFDLElBQUksQ0FBQyxjQUFjO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSx5QkFBeUIsQ0FBQyxDQUFBO1FBRTVGLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQTtJQUM1QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxLQUFLLE9BQU8sa0VBQWtFLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQSxDQUFDLENBQUM7SUFFakk7OztPQUdHO0lBQ0gscUJBQXFCO1FBQ25CLElBQUksQ0FBQyxJQUFJLENBQUMsMEJBQTBCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxxQ0FBcUMsQ0FBQyxDQUFBO1FBRXBILE9BQU8sSUFBSSxDQUFDLDBCQUEwQixDQUFBO0lBQ3hDLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FzQ0c7SUFDSCxlQUFlLENBQUMsR0FBRztRQUNqQixPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEdBQUcsRUFBRTtZQUNoRSxLQUFLLEdBQUcsQ0FBQTtZQUVSLE9BQU8sSUFBSSxDQUFDLDBCQUEwQixFQUFFLElBQUksRUFBRSxDQUFBO1FBQ2hELENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILDBCQUEwQjtRQUN4QixNQUFNLGFBQWEsR0FBRywrQ0FBK0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUN4RixNQUFNLG1CQUFtQixHQUFHLDBDQUEwQyxDQUFDLENBQUMsYUFBYSxDQUFDLHlCQUF5QixDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQTtRQUV0SSxPQUFPLG1CQUFtQixJQUFJLElBQUksQ0FBQTtJQUNwQyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFDO1FBQzNDLE9BQU8sY0FBYyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFDLENBQUMsRUFBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQ3JFLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxxQkFBcUIsQ0FBQyxFQUFDLE9BQU8sRUFBRSxRQUFRLEVBQUM7UUFDdkMsS0FBSyxPQUFPLENBQUE7UUFDWixLQUFLLFFBQVEsQ0FBQTtRQUViLE9BQU8sRUFBQyxPQUFPLEVBQUUsSUFBSSxFQUFDLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7Ozs7OztPQVFHO0lBQ0gsOEJBQThCLENBQUMsRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFDO1FBQy9DLEtBQUssTUFBTSxDQUFBO1FBQ1gsS0FBSyxRQUFRLENBQUE7UUFFYixPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLE9BQU8sR0FBRyxJQUFJLENBQUMsT0FBTyxFQUFFLFNBQVMsR0FBRyxLQUFLLEVBQUUsUUFBUSxFQUFDO1FBQ3hFLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBQzVDLE1BQU0sS0FBSyxHQUFHLE9BQU87WUFDbkIsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxPQUFPLENBQUM7WUFDN0YsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFeEIsT0FBTyxNQUFNLEtBQUssQ0FBQyxNQUFNLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO0lBQzlGLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxpQkFBaUIsQ0FBQyxNQUFNO1FBQ3RCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQywwQkFBMEIsRUFBRSxTQUFTLENBQUE7UUFFNUQsSUFBSSxTQUFTLElBQUksT0FBTyxTQUFTLElBQUksUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQzNFLE1BQU0sYUFBYSxHQUFHLDREQUE0RCxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFdEcsSUFBSSxPQUFPLGFBQWEsSUFBSSxRQUFRLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLE9BQU8sYUFBYSxDQUFBO1FBQ3hGLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxTQUFTLENBQUMsSUFBSTtRQUNaLEtBQUssSUFBSSxDQUFBO1FBRVQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILGNBQWMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBQztRQUNqRCxLQUFLLE9BQU8sQ0FBQTtRQUNaLEtBQUssT0FBTyxDQUFBO1FBQ1osS0FBSyxRQUFRLENBQUE7UUFDYixLQUFLLE1BQU0sQ0FBQTtRQUVYLE9BQU8sRUFBRSxDQUFBO0lBQ1gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gseUJBQXlCLENBQUMsVUFBVSxFQUFFLE9BQU87UUFDM0MsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsMkJBQTJCLEVBQUUsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLEVBQUUsR0FBRyxFQUFFO1lBQzFGLEtBQUssT0FBTyxDQUFBO1lBRVosT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gseUJBQXlCLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPO1FBQ2xELE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLDJCQUEyQixFQUFFLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDakcsS0FBSyxLQUFLLENBQUE7WUFDVixLQUFLLE9BQU8sQ0FBQTtZQUVaLE9BQU8sVUFBVSxDQUFBO1FBQ25CLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILFlBQVksQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU87UUFDckMsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsY0FBYyxFQUFFLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDcEYsS0FBSyxLQUFLLENBQUE7WUFDVixLQUFLLFVBQVUsQ0FBQTtZQUNmLEtBQUssT0FBTyxDQUFBO1FBQ2QsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsV0FBVyxDQUFDLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTztRQUNwQyxPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxFQUFFLEdBQUcsRUFBRTtZQUNuRixLQUFLLEtBQUssQ0FBQTtZQUNWLEtBQUssVUFBVSxDQUFBO1lBQ2YsS0FBSyxPQUFPLENBQUE7UUFDZCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxZQUFZLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPO1FBQ3JDLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLGNBQWMsRUFBRSxDQUFDLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLEVBQUUsR0FBRyxFQUFFO1lBQ3BGLEtBQUssS0FBSyxDQUFBO1lBQ1YsS0FBSyxVQUFVLENBQUE7WUFDZixLQUFLLE9BQU8sQ0FBQTtRQUNkLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILFdBQVcsQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU87UUFDcEMsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsYUFBYSxFQUFFLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDbkYsS0FBSyxLQUFLLENBQUE7WUFDVixLQUFLLFVBQVUsQ0FBQTtZQUNmLEtBQUssT0FBTyxDQUFBO1FBQ2QsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxLQUFLO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLGVBQWUsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLEdBQUcsRUFBRTtZQUNoRSxLQUFLLEtBQUssQ0FBQTtRQUNaLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsS0FBSztRQUNoQixPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDL0QsS0FBSyxLQUFLLENBQUE7UUFDWixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFDO1FBQ3BELE9BQU8sTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsd0JBQXdCLEVBQUUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFDLENBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN6RyxLQUFLLE1BQU0sQ0FBQTtZQUNYLEtBQUssS0FBSyxDQUFBO1lBRVYsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO1FBQ3pCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVU7UUFDUixNQUFNLGFBQWEsR0FBRywrQ0FBK0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUV4RixPQUFPLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGVBQWUsQ0FBQyxNQUFNLEVBQUUsT0FBTztRQUM3QiwrREFBK0Q7UUFDL0QsT0FBTyw0RkFBNEYsQ0FBQyxDQUFDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDLG1DQUFtQyxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFBO0lBQzNMLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsVUFBVSxDQUFDLE9BQU8sR0FBRyxFQUFFO1FBQ3JCLE9BQU8sNEZBQTRGLENBQUMsQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQyx1QkFBdUIsQ0FBQztZQUMxSixHQUFHLE9BQU87WUFDVixRQUFRLEVBQUUsSUFBSTtTQUNmLENBQUMsQ0FBQyxDQUFBO0lBQ0wsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxpQ0FBaUMsQ0FBQyxFQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFDO1FBQy9ELFVBQVUsQ0FBQyw0QkFBNEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQzlELENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsNkJBQTZCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBQztRQUN2RCxVQUFVLENBQUMsd0JBQXdCLENBQUMsRUFBQyxLQUFLLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtJQUN0RCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDJCQUEyQixDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUM7UUFDbkQsVUFBVSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7SUFDbEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsTUFBTTtRQUNsQixLQUFLLE1BQU0sQ0FBQTtRQUVYLE9BQU8sTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEtBQUsseUJBQXlCLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQTtJQUM1RixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxNQUFNO1FBQ2xCLEtBQUssTUFBTSxDQUFBO1FBRVgsT0FBTyxNQUFNLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sS0FBSyx5QkFBeUIsQ0FBQyxTQUFTLENBQUMsT0FBTztZQUN4RixNQUFNLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyx5QkFBeUIsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFBO0lBQ25GLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsWUFBWSxDQUFDLE1BQU07UUFDakIsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsY0FBYyxFQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsR0FBRyxFQUFFO1lBQ2hFLEtBQUssTUFBTSxDQUFBO1lBRVgsb0JBQW9CO1FBQ3RCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsT0FBTyxNQUFNLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUMxQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsc0JBQXNCO1FBQ3BCLE9BQU8sRUFBRSxDQUFBO0lBQ1gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsT0FBTyxNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUNyRSxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFO1FBQ25CLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDeEMsTUFBTSxPQUFPLEdBQUcsTUFBTSxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUMsb0JBQW9CLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRWhHLElBQUksT0FBTyxFQUFFLENBQUM7WUFDWixLQUFLLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUNoQyxDQUFDO1FBRUQsT0FBTyxNQUFNLEtBQUssQ0FBQyxNQUFNLENBQUMseUJBQXlCLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUE7SUFDN0UsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsT0FBTyxHQUFHLEVBQUU7UUFDbkMsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDdEYsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLENBQUE7UUFDNUcsTUFBTSxNQUFNLEdBQUcsb0JBQW9CLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3ZKLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFBO1FBQzVDLE1BQU0sUUFBUSxHQUFHLHFDQUFxQyxDQUFDLFVBQVUsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLGVBQWUsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUM3SSxNQUFNLEtBQUssR0FBRyxJQUFJLFVBQVUsRUFBRSxDQUFBO1FBRTlCLE9BQU8sTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUM7WUFDdkMsTUFBTSxFQUFFLFFBQVE7WUFDaEIsS0FBSztZQUNMLFFBQVEsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkIsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxvQkFBb0IsRUFBRSxPQUFPLENBQUMsQ0FBQTtnQkFDN0QsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFdBQVcsRUFBRSxlQUFlLENBQUMsV0FBVyxFQUFDLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtnQkFFbkosTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxvQkFBb0IsRUFBRSxPQUFPLENBQUMsQ0FBQTtnQkFFakUsT0FBTyxVQUFVLENBQUE7WUFDbkIsQ0FBQztTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLDhCQUE4QixDQUFDLEtBQUs7UUFDeEMsTUFBTSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDdkIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLEdBQUcsRUFBRTtRQUMxQyxNQUFNLG9CQUFvQixHQUFHLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFDN0YsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLENBQUE7UUFDNUcsTUFBTSxNQUFNLEdBQUcsb0JBQW9CLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixFQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3ZKLE1BQU0sUUFBUSxHQUFHLHFDQUFxQyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsYUFBYSxFQUFFLEVBQUUsZUFBZSxDQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXpJLE9BQU8sTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUM7WUFDdkMsTUFBTSxFQUFFLFFBQVE7WUFDaEIsS0FBSztZQUNMLFFBQVEsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkIsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxvQkFBb0IsRUFBRSxPQUFPLENBQUMsQ0FBQTtnQkFDN0QsTUFBTSxVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxFQUFDLEdBQUcsT0FBTyxFQUFFLFdBQVcsRUFBRSxlQUFlLENBQUMsV0FBVyxFQUFDLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtnQkFFbkosTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxvQkFBb0IsRUFBRSxPQUFPLENBQUMsQ0FBQTtnQkFFakUsT0FBTyxVQUFVLENBQUE7WUFDbkIsQ0FBQztTQUNGLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLEVBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFDO1FBQ2hFLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ3JELE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQTtZQUNyRCxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxXQUFXLElBQUksSUFBSSxFQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUU5RSxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1lBQ2pILENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUVsQixJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1lBQ3hHLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtRQUVGLE1BQU0sSUFBSSxDQUFDLG1DQUFtQyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUU3RCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsVUFBVTtRQUMvQyw0REFBNEQ7UUFDNUQsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7UUFDM0IsTUFBTSxhQUFhLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDeEYsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLDBCQUEwQixFQUFFLElBQUksRUFBRSxDQUFDLENBQUE7UUFFL0UsS0FBSyxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUN2RCxNQUFNLGtCQUFrQixHQUFHLE1BQU0sVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFBO1lBQ3JFLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUU5RCxJQUFJLGNBQWMsRUFBRSxDQUFDO2dCQUNuQixNQUFNLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQ3pFLENBQUM7aUJBQU0sSUFBSSxhQUFhLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sSUFBSSxDQUFDLDhCQUE4QixDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDL0QsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGdCQUFnQixDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUNoQyxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxLQUFLLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDaEMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCw0QkFBNEIsQ0FBQyxVQUFVLEVBQUUsV0FBVztRQUNsRCxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3ZFLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFBO1FBRW5FLElBQUksZUFBZSxDQUFDLElBQUksS0FBSyxDQUFDO1lBQUUsT0FBTyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUMsQ0FBQTtRQUVoRSxJQUFJLFdBQVcsS0FBSyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUN4RCxNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7UUFDMUQsQ0FBQztRQUVELDREQUE0RDtRQUM1RCxNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtRQUM1QixtRUFBbUU7UUFDbkUsSUFBSSxpQkFBaUIsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRTdELEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDaEUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztnQkFDeEMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFBO2dCQUN4QyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksQ0FBQyxpQkFBaUI7Z0JBQUUsaUJBQWlCLEdBQUcsRUFBRSxDQUFBO1lBQzlDLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQzNFLE1BQU0sSUFBSSxLQUFLLENBQUMsZUFBZSxhQUFhLHFEQUFxRCxDQUFDLENBQUE7WUFDcEcsQ0FBQztZQUVELGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMxQyxDQUFDO1FBRUQsT0FBTyxFQUFDLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQTtJQUN4RSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsa0JBQWtCLENBQUMsS0FBSyxFQUFFLFdBQVcsRUFBRSx1QkFBdUI7UUFDNUQsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFNO1FBQ3hCLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFBO1FBRXpGLE1BQU0sU0FBUyxHQUFHLElBQUksR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUE7UUFDbEQsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ3hDLE1BQU0scUJBQXFCLEdBQUcsVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDNUQsdUJBQXVCO1FBQ3ZCLE1BQU0sdUJBQXVCLEdBQUcsRUFBRSxDQUFBO1FBQ2xDLHVCQUF1QjtRQUN2QixNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtRQUU3QixLQUFLLE1BQU0sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQ2xFLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7Z0JBQ25DLHVCQUF1QixDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtnQkFDNUMsU0FBUTtZQUNWLENBQUM7WUFDRCxJQUFJLENBQUMscUJBQXFCLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDM0Msa0JBQWtCLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO2dCQUN2QyxTQUFRO1lBQ1YsQ0FBQztZQUVELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDOUQsQ0FBQztRQUVELElBQUksdUJBQXVCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyx1RUFBdUUsdUJBQXVCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO1FBQ2xMLENBQUM7UUFDRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsQyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsNENBQTRDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtRQUNsSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEtBQUs7UUFDckQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUE7UUFDakQsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUMvRCxNQUFNLG9CQUFvQixHQUFHLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUV4RSx3RUFBd0U7UUFDeEUsSUFBSSxXQUFXLENBQUE7UUFFZixJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQ3hCLE1BQU0sTUFBTSxHQUFHLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFBO1lBRTVDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUMxQixXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsNERBQTRELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxNQUFNLENBQUMsQ0FBQTtZQUN4SCxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQztnQkFDekMsTUFBTSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDOUMsQ0FBQztZQUVELE1BQU0sTUFBTSxHQUFHLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFBO1lBRTVDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUMxQixXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsNERBQTRELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxNQUFNLENBQUMsQ0FBQTtZQUN4SCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqQixXQUFXLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLEVBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUNwRCxDQUFDO1FBRUQsNERBQTREO1FBQzVELE1BQU0sV0FBVyxHQUFHLEVBQUUsQ0FBQTtRQUV0QixXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFBO1FBQ3pCLFdBQVcsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUs7UUFDakIsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUM7WUFDaEMsTUFBTSxFQUFFLFNBQVM7WUFDakIsS0FBSztZQUNMLFFBQVEsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkIsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFBO2dCQUMvQixNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtnQkFDckIsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2hDLENBQUM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNO1FBQzNCLEtBQUssTUFBTSxDQUFBO1FBRVgsT0FBTyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBQztRQUN4RixJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsZ0JBQWdCLGtDQUFrQyxDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQy9DLE1BQU0sZUFBZSxHQUFHLGdCQUFnQixDQUFDLDJCQUEyQixDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFdEYsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxnQkFBZ0IsQ0FBQyxJQUFJLDJDQUEyQyxnQkFBZ0IscUJBQXFCLGdCQUFnQixDQUFDLElBQUksZ0NBQWdDLGdCQUFnQixLQUFLLENBQUMsQ0FBQTtRQUMzTSxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMscUJBQXFCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUM3RSxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUMvQyxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsRUFBQyxDQUFDLENBQUE7UUFDOUcsTUFBTSxnQkFBZ0IsR0FBRyxXQUFXLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVwRSxJQUFJLGdCQUFnQixJQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3RELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELGdCQUFnQixvQkFBb0IsZ0JBQWdCLENBQUMsSUFBSSw4RUFBOEUsZ0JBQWdCLENBQUMsSUFBSSxnQ0FBZ0MsZ0JBQWdCLFVBQVUsQ0FBQyxDQUFBO1FBQzNSLENBQUM7UUFDRCxJQUFJLE9BQU8sZUFBZSxDQUFDLEtBQUssS0FBSyxRQUFRLElBQUksb0JBQW9CLENBQUMsTUFBTSxHQUFHLGVBQWUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNyRyxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0Isc0NBQXNDLGVBQWUsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFBO1FBQ3RILENBQUM7UUFDRCxJQUFJLGdCQUFnQixLQUFLLFNBQVMsSUFBSSxvQkFBb0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDRCQUE0QixnQkFBZ0IsaUJBQWlCLENBQUMsQ0FBQTtRQUNySCxDQUFDO1FBRUQsTUFBTSxnQkFBZ0IsR0FBRyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUUzRCxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxnQkFBZ0IsUUFBUSxnQkFBZ0IsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZILENBQUM7UUFFRCxNQUFNLG1CQUFtQixHQUFHLFVBQVUsQ0FBQywrQ0FBK0MsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBRXhHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELGdCQUFnQixDQUFDLFlBQVksRUFBRSx5QkFBeUIsZ0JBQWdCLElBQUksQ0FBQyxDQUFBO1FBQ3pKLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyx3Q0FBd0MsQ0FBQyxtQkFBbUIsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNqRyxNQUFNLGFBQWEsR0FBRyxJQUFJLGFBQWEsQ0FBQztZQUN0QyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsVUFBVTtZQUNWLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxJQUFJLEVBQUU7WUFDM0IsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLElBQUksRUFBRTtZQUN6QixVQUFVLEVBQUUsZ0JBQWdCO1lBQzVCLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxTQUFTO1lBQ3hDLE1BQU0sRUFBRSxVQUFVLENBQUMsbUJBQW1CLEVBQUU7WUFDeEMscUJBQXFCLEVBQUUsbUJBQW1CLENBQUMscUJBQXFCO1NBQ2pFLENBQUMsQ0FBQTtRQUNGLE1BQU0sZUFBZSxHQUFHLGFBQWEsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNsRCxNQUFNLHVCQUF1QixHQUFHLFdBQVcsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLEtBQUssVUFBVSxDQUFDLENBQUE7UUFDNUYsTUFBTSxPQUFPLEdBQUcsb0JBQW9CO2FBQ2pDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsV0FBVyxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsZ0JBQWdCLEVBQUMsQ0FBQyxDQUFDO2FBQ2pJLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ2hCLElBQUksT0FBTyxlQUFlLENBQUMsUUFBUSxLQUFLLFVBQVU7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFFL0QsT0FBTyxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDM0YsQ0FBQyxDQUFDLENBQUE7UUFFSixPQUFPO1lBQ0wsT0FBTyxFQUFFLFVBQVUsQ0FBQyxjQUFjLEVBQUUsSUFBSSxJQUFJLENBQUMsT0FBTztZQUNwRCxlQUFlO1lBQ2YsYUFBYTtZQUNiLG1CQUFtQjtZQUNuQix1QkFBdUI7WUFDdkIsZ0JBQWdCO1lBQ2hCLE9BQU87WUFDUCxZQUFZO1lBQ1osZ0JBQWdCO1NBQ2pCLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDO1FBQ3pFLElBQUksZ0JBQWdCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDL0IsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsZ0JBQWdCLGVBQWUsT0FBTyxVQUFVLEVBQUUsQ0FBQyxDQUFBO1lBQzdHLENBQUM7WUFFRCxPQUFPLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDOUIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDZCQUE2QixDQUFDLENBQUE7Z0JBRTlHLHdFQUF3RTtnQkFDeEUsT0FBTywrQ0FBK0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2hFLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELElBQUksVUFBVSxJQUFJLElBQUk7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUNqQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUM5QixPQUFPLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDOUIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDZCQUE2QixDQUFDLENBQUE7Z0JBRTlHLHdFQUF3RTtnQkFDeEUsT0FBTywrQ0FBK0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2hFLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUNELElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMvQixNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxnQkFBZ0IsZUFBZSxPQUFPLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFDOUcsQ0FBQztRQUVELHdFQUF3RTtRQUN4RSxPQUFPLENBQUMsK0NBQStDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILGlDQUFpQyxDQUFDLEVBQUMsV0FBVyxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsZ0JBQWdCLEVBQUM7UUFDekcsb0RBQW9EO1FBQ3BELE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtRQUNyQixvREFBb0Q7UUFDcEQsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBQ3RCLG9EQUFvRDtRQUNwRCxNQUFNLGdCQUFnQixHQUFHLEVBQUUsQ0FBQTtRQUMzQiwrQ0FBK0M7UUFDL0MsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO1FBQ3JCLE1BQU0scUJBQXFCLEdBQUcsZ0JBQWdCLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtRQUVsRSxLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzNELElBQUksYUFBYSxLQUFLLElBQUksRUFBRSxDQUFDO2dCQUMzQixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQztvQkFDbkMseUJBQXlCLENBQUMsZUFBZSxFQUFFLEtBQUssQ0FBQyxDQUFBO29CQUNqRCxVQUFVLENBQUMsRUFBRSxHQUFHLDJFQUEyRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBQ3JHLENBQUM7cUJBQU0sQ0FBQztvQkFDTixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQzt3QkFDM0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLHlDQUF5QyxDQUFDLENBQUE7b0JBQ2pHLENBQUM7b0JBRUQsVUFBVSxDQUFDLEVBQUUsR0FBRyxLQUFLLENBQUE7Z0JBQ3ZCLENBQUM7Z0JBQ0QsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLGFBQWEsS0FBSyxVQUFVLEVBQUUsQ0FBQztnQkFDakMsSUFBSSxPQUFPLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFDL0IsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLHNDQUFzQyxDQUFDLENBQUE7Z0JBQzlGLENBQUM7Z0JBRUQsVUFBVSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUE7Z0JBQzNCLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxhQUFhLEtBQUssWUFBWSxFQUFFLENBQUM7Z0JBQ25DLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDO29CQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQix3Q0FBd0MsQ0FBQyxDQUFBO2dCQUN6SCxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQTtnQkFDaEMsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLGFBQWEsS0FBSyxhQUFhLEVBQUUsQ0FBQztnQkFDcEMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLHlDQUF5QyxDQUFDLENBQUE7Z0JBQzFILE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxDQUFBO2dCQUNqQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksYUFBYSxLQUFLLGtCQUFrQixFQUFFLENBQUM7Z0JBQ3pDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDO29CQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQiw4Q0FBOEMsQ0FBQyxDQUFBO2dCQUMvSCxNQUFNLENBQUMsTUFBTSxDQUFDLGdCQUFnQixFQUFFLEtBQUssQ0FBQyxDQUFBO2dCQUN0QyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO2dCQUN6QyxNQUFNLHNCQUFzQixHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUUzRSxJQUFJLENBQUMsc0JBQXNCO29CQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLGFBQWEsRUFBRSxDQUFDLENBQUE7Z0JBQy9GLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDLHNCQUFzQixDQUFDLEVBQUUsQ0FBQztvQkFDaEQsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsc0JBQXNCLDhCQUE4QixnQkFBZ0IsZUFBZSxhQUFhLGlDQUFpQyxDQUFDLENBQUE7Z0JBQzlLLENBQUM7Z0JBRUQsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUMsR0FBRyxLQUFLLENBQUE7Z0JBQ2hELFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxxQkFBcUIsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUN6QyxXQUFXLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFBO1lBQ3BDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixVQUFVLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFBO1lBQ25DLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsVUFBVSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7UUFDMUUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsVUFBVSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUE7UUFDN0UsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxVQUFVLENBQUMsZ0JBQWdCLEdBQUcsZ0JBQWdCLENBQUE7UUFFNUYsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsK0JBQStCLENBQUMsTUFBTSxFQUFFLGdCQUFnQixFQUFFLFVBQVUsRUFBRSxZQUFZLEdBQUcsSUFBSTtRQUM3RixNQUFNLGNBQWMsR0FBRyxZQUFZO2VBQzlCLG9CQUFvQixDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFFM0gsS0FBSyxNQUFNLGdCQUFnQixJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO1lBQzdELE1BQU0sV0FBVyxHQUFHLGNBQWMsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtZQUUzRCxJQUFJLENBQUMsV0FBVztnQkFBRSxTQUFRO1lBRTFCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQztnQkFDOUMsV0FBVztnQkFDWCxVQUFVO2dCQUNWLE1BQU07Z0JBQ04sVUFBVSxFQUFFLGdCQUFnQixDQUFDLGdCQUFnQixDQUFDO2dCQUM5QyxnQkFBZ0I7YUFDakIsQ0FBQyxDQUFBO1lBRUYsSUFBSSxPQUFPLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxLQUFLLFdBQVc7Z0JBQUUsU0FBUTtZQUU1RCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQTtZQUVsRyxLQUFLLE1BQU0sS0FBSyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDcEMsSUFBSSxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7b0JBQ25CLElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQzt3QkFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLHdGQUF3RixDQUFDLENBQUE7b0JBQ2hKLENBQUM7b0JBQ0QsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLEVBQUUsQ0FBQTtvQkFFbkIsSUFBSSxFQUFFLElBQUksU0FBUzt3QkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0IscUNBQXFDLENBQUMsQ0FBQTtvQkFFaEgsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUM7d0JBQzVDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTzt3QkFDeEIsTUFBTSxFQUFFLFNBQVM7d0JBQ2pCLGVBQWUsRUFBRSxPQUFPLENBQUMsZUFBZTt3QkFDeEMsMEJBQTBCLEVBQUUsT0FBTyxDQUFDLG1CQUFtQixDQUFDLHFCQUFxQjt3QkFDN0UsRUFBRTt3QkFDRixnQkFBZ0I7d0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7cUJBQzNDLENBQUMsQ0FBQTtvQkFFRixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFBO29CQUM3QyxNQUFNLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsQ0FBQTtvQkFDckMsU0FBUTtnQkFDVixDQUFDO2dCQUVELE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLENBQUE7Z0JBQ25CLE1BQU0sS0FBSyxHQUFHLEVBQUUsSUFBSSxTQUFTO29CQUMzQixDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUM7d0JBQzdCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTzt3QkFDeEIsTUFBTSxFQUFFLFFBQVE7d0JBQ2hCLGVBQWUsRUFBRSxPQUFPLENBQUMsZUFBZTt3QkFDeEMsMEJBQTBCLEVBQUUsT0FBTyxDQUFDLG1CQUFtQixDQUFDLHFCQUFxQjt3QkFDN0UsRUFBRTt3QkFDRixnQkFBZ0I7d0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7cUJBQzNDLENBQUM7b0JBQ0YsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLGdCQUFnQixFQUFFLENBQUE7Z0JBRWxDLE1BQU0sT0FBTyxDQUFDLGFBQWEsQ0FBQyx5QkFBeUIsQ0FBQztvQkFDcEQsS0FBSztvQkFDTCx1QkFBdUIsRUFBRSxPQUFPLENBQUMsdUJBQXVCO29CQUN4RCxLQUFLO2lCQUNOLENBQUMsQ0FBQTtnQkFDRixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsK0JBQStCLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLEVBQUUsVUFBVSxFQUFFLFdBQVcsQ0FBQyxDQUFBO2dCQUN6SCxNQUFNLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQTtnQkFFbEIsSUFBSSxFQUFFLElBQUksU0FBUyxFQUFFLENBQUM7b0JBQ3BCLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDO3dCQUNoQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87d0JBQ3hCLEtBQUs7d0JBQ0wsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlO3dCQUN4QywwQkFBMEIsRUFBRSxPQUFPLENBQUMsbUJBQW1CLENBQUMscUJBQXFCO3dCQUM3RSxnQkFBZ0I7d0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7cUJBQzNDLENBQUMsQ0FBQTtnQkFDSixDQUFDO2dCQUVELElBQUksS0FBSyxDQUFDLGdCQUFnQixFQUFFLENBQUM7b0JBQzNCLE1BQU0sT0FBTyxDQUFDLGFBQWEsQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLGdCQUFnQixFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQTtnQkFDNUcsQ0FBQztnQkFFRCxNQUFNLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSwwQkFBMEIsQ0FBQyxLQUFLLENBQUMsRUFBRSxFQUFFLEVBQUUsK0JBQStCLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUE7WUFDdEksQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7O09BaUJHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQixDQUFDLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsWUFBWSxHQUFHLElBQUk7UUFDcEYsTUFBTSxjQUFjLEdBQUcsWUFBWTtlQUM5QixvQkFBb0IsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTNILEtBQUssTUFBTSxnQkFBZ0IsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQztZQUM3RCxNQUFNLFdBQVcsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUE7WUFFM0QsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUNqQixNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixnQkFBZ0IsMEJBQTBCLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxnQ0FBZ0MsZ0JBQWdCLDRDQUE0QyxDQUFDLENBQUE7WUFDeE0sQ0FBQztZQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQztnQkFDOUMsV0FBVztnQkFDWCxVQUFVO2dCQUNWLE1BQU07Z0JBQ04sVUFBVSxFQUFFLGdCQUFnQixDQUFDLGdCQUFnQixDQUFDO2dCQUM5QyxnQkFBZ0I7YUFDakIsQ0FBQyxDQUFBO1lBRUYsSUFBSSxPQUFPLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxLQUFLLFdBQVc7Z0JBQUUsU0FBUTtZQUU1RCxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyxtQ0FBbUMsQ0FBQztnQkFDcEUsTUFBTTtnQkFDTixZQUFZLEVBQUUsT0FBTyxDQUFDLFlBQVk7Z0JBQ2xDLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7YUFDM0MsQ0FBQyxDQUFBO1lBRUYsTUFBTSxjQUFjLEdBQUcsRUFBRSxDQUFBO1lBQ3pCLE1BQU0sYUFBYSxHQUFHLEVBQUUsQ0FBQTtZQUN4QixNQUFNLGFBQWEsR0FBRyxFQUFFLENBQUE7WUFFeEIsS0FBSyxNQUFNLEtBQUssSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ3BDLElBQUksS0FBSyxFQUFFLFFBQVEsRUFBRSxDQUFDO29CQUNwQixJQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLENBQUM7d0JBQzlCLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQix3RkFBd0YsQ0FBQyxDQUFBO29CQUNoSixDQUFDO29CQUNELElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxFQUFFLENBQUM7d0JBQ2QsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLHFDQUFxQyxDQUFDLENBQUE7b0JBQzdGLENBQUM7b0JBQ0QsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDNUIsQ0FBQztxQkFBTSxJQUFJLEtBQUssRUFBRSxFQUFFLEVBQUUsQ0FBQztvQkFDckIsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFDM0IsQ0FBQztxQkFBTSxDQUFDO29CQUNOLGFBQWEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBQzNCLENBQUM7WUFDSCxDQUFDO1lBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxjQUFjLEVBQUUsQ0FBQztnQkFDbkMsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLEVBQUUsQ0FBQTtnQkFFbkIsSUFBSSxFQUFFLElBQUksU0FBUyxFQUFFLENBQUM7b0JBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQixxQ0FBcUMsQ0FBQyxDQUFBO2dCQUM3RixDQUFDO2dCQUVELE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDO29CQUMzQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87b0JBQ3hCLE1BQU0sRUFBRSxTQUFTO29CQUNqQixlQUFlLEVBQUUsT0FBTyxDQUFDLGVBQWU7b0JBQ3hDLDBCQUEwQixFQUFFLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxxQkFBcUI7b0JBQzdFLEVBQUU7b0JBQ0YsTUFBTTtvQkFDTixvQkFBb0I7b0JBQ3BCLGdCQUFnQjtvQkFDaEIsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLGdCQUFnQjtpQkFDM0MsQ0FBQyxDQUFBO2dCQUVGLE1BQU0sT0FBTyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDL0MsQ0FBQztZQUVELEtBQUssTUFBTSxLQUFLLElBQUksYUFBYSxFQUFFLENBQUM7Z0JBQ2xDLE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLENBQUE7Z0JBRW5CLElBQUksRUFBRSxJQUFJLFNBQVMsRUFBRSxDQUFDO29CQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0IsbUNBQW1DLENBQUMsQ0FBQTtnQkFDM0YsQ0FBQztnQkFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztvQkFDM0MsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO29CQUN4QixNQUFNLEVBQUUsUUFBUTtvQkFDaEIsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlO29CQUN4QywwQkFBMEIsRUFBRSxPQUFPLENBQUMsbUJBQW1CLENBQUMscUJBQXFCO29CQUM3RSxFQUFFO29CQUNGLE1BQU07b0JBQ04sb0JBQW9CO29CQUNwQixnQkFBZ0I7b0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7aUJBQzNDLENBQUMsQ0FBQTtnQkFFRixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUM7b0JBQ3BELEtBQUssRUFBRSxRQUFRO29CQUNmLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyx1QkFBdUI7b0JBQ3hELEtBQUs7aUJBQ04sQ0FBQyxDQUFBO2dCQUNGLE1BQU0sT0FBTyxDQUFDLGFBQWEsQ0FBQywrQkFBK0IsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLGdCQUFnQixJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBQzVILE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFBO2dCQUVyQixJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO29CQUMzQixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBQy9HLENBQUM7WUFDSCxDQUFDO1lBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxLQUFLLEdBQUcsSUFBSSxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtnQkFFNUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO2dCQUNsQyxNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUM7b0JBQ3BELEtBQUs7b0JBQ0wsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLHVCQUF1QjtvQkFDeEQsS0FBSztpQkFDTixDQUFDLENBQUE7Z0JBQ0YsTUFBTSxPQUFPLENBQUMsYUFBYSxDQUFDLCtCQUErQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsZ0JBQWdCLElBQUksRUFBRSxFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQTtnQkFDekgsTUFBTSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUE7Z0JBRWxCLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDO29CQUNoQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87b0JBQ3hCLEtBQUs7b0JBQ0wsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlO29CQUN4QywwQkFBMEIsRUFBRSxPQUFPLENBQUMsbUJBQW1CLENBQUMscUJBQXFCO29CQUM3RSxnQkFBZ0I7b0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7aUJBQzNDLENBQUMsQ0FBQTtnQkFFRixJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO29CQUMzQixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBQzVHLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QixDQUFDLEVBQUMsS0FBSyxFQUFFLHVCQUF1QixFQUFFLEtBQUssRUFBQztRQUNyRSxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbURBQW1ELENBQUMsQ0FBQTtZQUUxRyxNQUFNLFFBQVEsR0FBRyxxQ0FBcUMsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLGFBQWEsRUFBRSxFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLHVCQUF1QixDQUFDLENBQUE7WUFDckksTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZELENBQUM7UUFFRCxJQUFJLEtBQUssQ0FBQyxXQUFXLEtBQUssU0FBUyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQ3pFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQTtRQUN2RSxDQUFDO1FBRUQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsV0FBVyxJQUFJLElBQUksRUFBRSx1QkFBdUIsQ0FBQyxDQUFBO0lBQ3BGLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILDRCQUE0QixDQUFDLFlBQVksRUFBRSxVQUFVO1FBQ25ELE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtRQUUvQyxPQUFPLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLFVBQVUsQ0FBQTtJQUMvRSxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILG1DQUFtQyxDQUFDLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxnQkFBZ0IsRUFBQztRQUMxRSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsWUFBWSxFQUFFLGdCQUFnQixDQUFDLENBQUE7UUFDcEYsOENBQThDO1FBQzlDLE1BQU0sVUFBVSxHQUFHLEVBQUMsQ0FBQyxVQUFVLENBQUMsRUFBRSwwQkFBMEIsQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLEVBQUUsMEJBQTBCLE1BQU0sQ0FBQyxhQUFhLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFDLENBQUE7UUFFbkksSUFBSSxZQUFZLENBQUMsY0FBYyxFQUFFLEVBQUUsQ0FBQztZQUNsQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsaUNBQWlDLENBQUMsWUFBWSxFQUFFLGdCQUFnQixDQUFDLENBQUE7WUFFNUYsVUFBVSxDQUFDLGFBQWEsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxhQUFhLEVBQUUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtRQUNuRSxDQUFDO1FBRUQsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsaUNBQWlDLENBQUMsWUFBWSxFQUFFLFVBQVU7UUFDeEQsTUFBTSxVQUFVLEdBQUcsWUFBWSxDQUFDLHdCQUF3QixFQUFFLENBQUE7UUFFMUQsT0FBTyxVQUFVLENBQUMsK0JBQStCLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLENBQUE7SUFDL0UsQ0FBQztJQUVEOzs7Ozs7Ozs7OztPQVdHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsMEJBQTBCLEVBQUUsRUFBRSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDO1FBQzVILE1BQU0sS0FBSyxHQUFHLE9BQU87WUFDbkIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsMEJBQTBCLEVBQUUsTUFBTSxDQUFDLEVBQUUsT0FBTyxDQUFDO1lBQzlHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDOUIsTUFBTSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsTUFBTSxDQUFDLHlCQUF5QixDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBRW5GLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxNQUFNLFdBQVcsZ0JBQWdCLE9BQU8sRUFBRSx3Q0FBd0MsQ0FBQyxDQUFBO1FBQy9HLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCwwQkFBMEIsQ0FBQywwQkFBMEIsRUFBRSxNQUFNO1FBQzNELE1BQU0sU0FBUyxHQUFHLDBCQUEwQixFQUFFLFNBQVMsQ0FBQTtRQUV2RCxJQUFJLENBQUMsU0FBUyxJQUFJLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDNUUsTUFBTSxJQUFJLEtBQUssQ0FBQywrRUFBK0UsTUFBTSxHQUFHLENBQUMsQ0FBQTtRQUMzRyxDQUFDO1FBRUQsTUFBTSxhQUFhLEdBQUcscUNBQXFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUvRSxJQUFJLE9BQU8sYUFBYSxLQUFLLFFBQVEsSUFBSSxhQUFhLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2xFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLE1BQU0sR0FBRyxDQUFDLENBQUE7UUFDM0UsQ0FBQztRQUVELE9BQU8sYUFBYSxDQUFBO0lBQ3RCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsRUFBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLGVBQWUsRUFBRSwwQkFBMEIsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDO1FBQ3pKLE1BQU0sa0JBQWtCLEdBQUcseUJBQXlCLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRXpFLEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxXQUFXLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLG9CQUFvQixDQUFDLEVBQUUsQ0FBQztZQUNoRixJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxhQUFhLENBQUMsSUFBSSxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsS0FBSyxXQUFXLEVBQUUsQ0FBQztnQkFDakksTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLE1BQU0sV0FBVyxnQkFBZ0IsT0FBTyxFQUFFLHNCQUFzQixhQUFhLDJCQUEyQixNQUFNLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSxPQUFPLE1BQU0sQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUE7WUFDdEwsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxFQUFDLEdBQUcsa0JBQWtCLEVBQUUsR0FBRyxvQkFBb0IsRUFBQyxDQUFBO1FBQy9ELE1BQU0sS0FBSyxHQUFHLE9BQU87WUFDbkIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsMEJBQTBCLEVBQUUsTUFBTSxDQUFDLEVBQUUsT0FBTyxDQUFDO1lBQzlHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFOUIsTUFBTSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTNDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxNQUFNLFdBQVcsZ0JBQWdCLE9BQU8sRUFBRSxrREFBa0QsTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFDLElBQUksT0FBTyxNQUFNLENBQUMsRUFBRSxFQUFFLDBCQUEwQixDQUFDLENBQUE7UUFDaE0sQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBQyxPQUFPLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSwwQkFBMEIsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsRUFBQztRQUM1SCxJQUFJLENBQUMsT0FBTztZQUFFLE9BQU07UUFFcEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDLDBCQUEwQixFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQzNGLE1BQU0sUUFBUSxHQUFHLHdCQUF3QixDQUFDLGVBQWUsRUFBRSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFBO1FBQ2pILE1BQU0sZUFBZSxHQUFHLE1BQU0sZ0JBQWdCO2FBQzNDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDO2FBQ3JDLE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQyxlQUFlLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQTtRQUUvRCxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDckIsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQkFBb0IsZ0JBQWdCLElBQUksZ0JBQWdCLENBQUMsSUFBSSxtQkFBbUIsQ0FBQyxDQUFBO1FBQ25HLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxLQUFLLEVBQUUsTUFBTTtRQUNyRCxNQUFNLGlCQUFpQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRXBELElBQUksaUJBQWlCLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRTFDLEtBQUssTUFBTSxnQkFBZ0IsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQ2pELE1BQU0sS0FBSyxDQUFDLGdCQUFnQixDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDaEQsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxTQUFTLG9CQUFvQixDQUFDLFVBQVU7SUFDdEMsdUJBQXVCO0lBQ3ZCLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtJQUNyQiw0R0FBNEc7SUFDNUcsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFBO0lBRWpCLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQztRQUFFLE9BQU8sRUFBQyxVQUFVLEVBQUUsTUFBTSxFQUFDLENBQUE7SUFFM0QsS0FBSyxNQUFNLEtBQUssSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUMvQixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzlCLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDeEIsQ0FBQzthQUFNLElBQUksS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN2RSxLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNqRCxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO29CQUNoQyxNQUFNLElBQUksS0FBSyxDQUFDLDBGQUEwRixHQUFHLFlBQVksR0FBRyxzQkFBc0IsQ0FBQyxDQUFBO2dCQUNySixDQUFDO2dCQUNELE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBRTNELElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO29CQUN0QixNQUFNLElBQUksS0FBSyxDQUFDLGtFQUFrRSxHQUFHLElBQUksQ0FBQyxDQUFBO2dCQUM1RixDQUFDO2dCQUNELElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsc0NBQXNDLEdBQUcsc0NBQXNDLE9BQU8sS0FBSyxHQUFHLENBQUMsQ0FBQTtnQkFDakgsQ0FBQztnQkFFRCxNQUFNLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUN4RCxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksS0FBSyxDQUFDLG1GQUFtRixPQUFPLEtBQUssR0FBRyxDQUFDLENBQUE7UUFDckgsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEVBQUMsVUFBVSxFQUFFLE1BQU0sRUFBQyxDQUFBO0FBQzdCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsdUJBQXVCLENBQUMsUUFBUSxFQUFFLFVBQVU7SUFDbkQsSUFBSSxTQUFTLEdBQUcsTUFBTSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUUvQyxPQUFPLFNBQVMsRUFBRSxDQUFDO1FBQ2pCLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxVQUFVLENBQUM7WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUVqRixTQUFTLEdBQUcsTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQTtJQUM5QyxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUE7QUFDYixDQUFDO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILFNBQVMscUNBQXFDLENBQzVDLFFBQVEsRUFDUixhQUFhLEVBQ2IsVUFBVSxFQUNWLFFBQVEsR0FBRywrRkFBK0YsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUNqSCx1QkFBdUIsR0FBRyxJQUFJO0lBRTlCLHlGQUF5RjtJQUN6RixxRkFBcUY7SUFDckYsNERBQTREO0lBQzVELE1BQU0sa0JBQWtCLEdBQUcsRUFBRSxDQUFBO0lBQzdCLHVCQUF1QjtJQUN2QixNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtJQUM1Qix1QkFBdUI7SUFDdkIsTUFBTSxzQkFBc0IsR0FBRyxFQUFFLENBQUE7SUFFakMsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDbEcsdUJBQXVCO0lBQ3ZCLElBQUksb0JBQW9CLEdBQUcsRUFBRSxDQUFBO0lBRTdCLElBQUksUUFBUSxFQUFFLENBQUM7UUFDYixNQUFNLGFBQWEsR0FBRywrQ0FBK0MsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUU1RixvQkFBb0IsR0FBRyxhQUFhLENBQUMsMEJBQTBCLEVBQUUsSUFBSSxFQUFFLENBQUE7SUFDekUsQ0FBQztJQUVELE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUE7SUFFbkQsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUNoRSxJQUFJLFNBQVMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUMvQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7WUFDMUMsU0FBUTtRQUNWLENBQUM7UUFFRCxNQUFNLHFCQUFxQixHQUFHLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLENBQUMsSUFBSSxhQUFhLENBQUE7UUFDaEcsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLFVBQVUsQ0FBQyxRQUFRLENBQUMscUJBQXFCLENBQUMsRUFBRSxDQUFBO1FBQzlFLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyx5QkFBeUIsQ0FBQyxRQUFRLEVBQUUsbUJBQW1CLENBQUMsSUFBSSxtQkFBbUIsQ0FBQTtRQUNoSCxNQUFNLGtCQUFrQixHQUFHLE1BQU0sVUFBVSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFBO1FBQzlFLE1BQU0sY0FBYyxHQUFHLFFBQVEsRUFBRSxjQUFjLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUVuRSxJQUFJLFVBQVUsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUMzQixrQkFBa0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUE7UUFDM0MsQ0FBQzthQUFNLElBQUksY0FBYyxFQUFFLENBQUM7WUFDMUIsa0JBQWtCLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFBO1FBQzNDLENBQUM7YUFBTSxJQUFJLGFBQWEsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUM1QyxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUE7UUFDM0MsQ0FBQzthQUFNLENBQUM7WUFDTixpQkFBaUIsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLHNCQUFzQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN0QyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsdUVBQXVFLHNCQUFzQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtJQUNqTCxDQUFDO0lBRUQsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakMsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLDRDQUE0QyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFDLElBQUksRUFBRSxnQ0FBZ0MsRUFBQyxDQUFDLENBQUE7SUFDakosQ0FBQztJQUVELE9BQU8sa0JBQWtCLENBQUE7QUFDM0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSBmcm9tIFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5cbi8qKlxuICogQmFja2VuZCBvciBmcm9udGVuZCBtb2RlbCBjbGFzcyBib3VuZCB0byBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiKS5BdXRob3JpemF0aW9uUmVzb3VyY2VNb2RlbENsYXNzICYge2F0dGFjaG1lbnREZWZpbml0aW9uczogKCkgPT4gUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+LCBwcmltYXJ5S2V5OiAoKSA9PiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufX0gRnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc1xuICovXG5cbi8qKlxuICogQnVpbHQtaW4gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYWN0aW9uLlxuICogQHR5cGVkZWYge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb25cbiAqL1xuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGJ1aWxkaW5nIGFuIGF1dGhvcml6ZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcXVlcnkuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdXRob3JpemVkUXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkgeygpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gW3J1bGVRdWVyeUZhY3RvcnldIC0gUXVlcnkgZmFjdG9yeSB1c2VkIHdoZW4gYXV0aG9yaXphdGlvbiBtdXN0IHRhcmdldCBhIGNhcHR1cmVkIHJlY29yZCBzbmFwc2hvdC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgbWV0aG9kcyB1c2VkIGJ5IHJlc291cmNlcy5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHQgJiB7XG4gKiAgIGN1cnJlbnRBYmlsaXR5OiAoKSA9PiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCxcbiAqICAgYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbjogKGFyZ3M6IHtwYWdpbmF0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9uLCBxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSkgPT4gdm9pZCxcbiAqICAgYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoOiAoYXJnczoge3F1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sIHNlYXJjaDogRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSkgPT4gdm9pZCxcbiAqICAgYXBwbHlGcm9udGVuZE1vZGVsU29ydDogKGFyZ3M6IHtxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LCBzb3J0OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0fSkgPT4gdm9pZCxcbiAqICAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBY3Rpb246IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbikgPT4gc3RyaW5nLFxuICogICBmcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeTogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uLCBvcHRpb25zPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXV0aG9yaXplZFF1ZXJ5T3B0aW9ucykgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24sIG9wdGlvbnM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdXRob3JpemVkUXVlcnlPcHRpb25zKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5OiAob3B0aW9ucz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zICYge3Jlc291cmNlPzogUGljazxGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3M+LCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4UGFnaW5hdGlvblwiIHwgXCJhcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaFwiIHwgXCJhcHBseUZyb250ZW5kTW9kZWxJbmRleFNvcnRcIj59KSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxQYXJhbXM6ICgpID0+IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zLFxuICogICBmcm9udGVuZE1vZGVsUHJlbG9hZDogKCkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGwsXG4gKiAgIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzOiAobW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBudWxsLFxuICogICBzZXJpYWxpemVGcm9udGVuZE1vZGVsOiAobW9kZWw6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIG9iamVjdCB8IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsPj5cbiAqIH19IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJcbiAqL1xuXG4vKipcbiAqIEdlbmVyaWMgZnJvbnRlbmQtbW9kZWwgaW5kZXggcXVlcnkgcGFzc2VkIHRvIHJlc291cmNlIHF1ZXJ5IGhvb2tzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnlcbiAqL1xuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGJ1aWxkaW5nIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgaW5kZXggcXVlcnkuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVBhZ2luYXRpb25dIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBwYWdpbmF0aW9uIHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2luY2x1ZGVTb3J0XSAtIFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgc29ydCBwYXJhbXMgc2hvdWxkIGJlIGFwcGxpZWQuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9uXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGxpbWl0IC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb2Zmc2V0IC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGFnZSAtIDEtYmFzZWQgcGFnZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHBlclBhZ2UgLSBQYWdlIHNpemUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2ggdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIENvbHVtbiBvciBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7XCJlcVwiIHwgXCJsaWtlXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwifSBvcGVyYXRvciAtIFNlYXJjaCBvcGVyYXRvci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU2VhcmNoIHZhbHVlLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlU29ydCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU29ydFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIHNvcnQgYnkuXG4gKiBAcHJvcGVydHkge1wiYXNjXCIgfCBcImRlc2NcIn0gZGlyZWN0aW9uIC0gU29ydCBkaXJlY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGggZnJvbSByb290IG1vZGVsLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3MgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbVERhdGFiYXNlTW9kZWxDbGFzcz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJnc1xuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBjb250cm9sbGVyIC0gRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBpbnN0YW5jZS5cbiAqIEBwcm9wZXJ0eSB7VERhdGFiYXNlTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gKG9yIHJhdyBpbnB1dCBzaGFwZSBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHR5cGUuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFtUTW9kZWxDbGFzcz1Gcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzXVxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3NcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2Ugd2hlbiB0aGUgcmVzb3VyY2UgaXMgdXNlZCBkaXJlY3RseSBmb3IgYXV0aG9yaXphdGlvbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbY29uZmlndXJhdGlvbl0gLSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbiBmb3IgY29udHJvbGxlci1sZXNzIGNvbnN0cnVjdGlvbiAoZm9yIGV4YW1wbGUgdGhlIHN5bmMgd2Vic29ja2V0IGNoYW5uZWwpOyB0aGUgY29udHJvbGxlciBwYXRoIGRlcml2ZXMgaXQgZnJvbSB0aGUgY29udHJvbGxlciBpbnN0ZWFkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSBbY29udGV4dF0gLSBBYmlsaXR5IGNvbnRleHQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtsb2NhbHNdIC0gQWJpbGl0eSBsb2NhbHMuXG4gKiBAcHJvcGVydHkge1RNb2RlbENsYXNzfSBbbW9kZWxDbGFzc10gLSBPcHRpb25hbCBiYWNraW5nIG1vZGVsIGNsYXNzIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFttb2RlbE5hbWVdIC0gT3B0aW9uYWwgbW9kZWwgbmFtZSBvdmVycmlkZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBbcmVzb3VyY2VDb25maWd1cmF0aW9uXSAtIE9wdGlvbmFsIG5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuXG4vKipcbiAqIEludGVybmFsIGNvbnN0cnVjdG9yIGNvbnRyYWN0IHVzZWQgd2hlbiBhIHJlc291cmNlIGluc3RhbnRpYXRlcyBpdHMgc2hhcmVkXG4gKiBjb3VudGVycGFydCBhY3Jvc3MgdGhlIGZyb250ZW5kL2JhY2tlbmQgbW9kZWwgYm91bmRhcnkuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFRNb2RlbENsYXNzXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gVERhdGFiYXNlTW9kZWxDbGFzc1xuICogQHR5cGVkZWYge3tuZXcgKGFyZ3M6IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzPEZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3M+IHwgRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3MpOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPn19IEZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3JcbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZWQgc3luYyByZXBsYXkgbXV0YXRpb24gcGFzc2VkIHRvIHRoZSByZXNvdXJjZSBzeW5jIGhvb2tzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL3N5bmMvc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IEZyb250ZW5kTW9kZWxTeW5jTXV0YXRpb25cbiAqL1xuXG4vKipcbiAqIFN5bmMgbXV0YXRpb24gYXV0aG9yaXphdGlvbiByZXN1bHQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb25cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gYWxsb3dlZCAtIFdoZXRoZXIgdGhlIG11dGF0aW9uIG1heSBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtyZWFzb25dIC0gU3RhYmxlIGZhaWx1cmUgcmVhc29uIGNvZGUgd2hlbiBkZW5pZWQuXG4gKi9cblxuLyoqXG4gKiBBcmd1bWVudHMgZm9yIHRoZSBhcHBseVN5bmMgZnVsbC1lc2NhcGUtaGF0Y2ggaG9vay5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxBcHBseVN5bmNBcmdzXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGV4aXN0aW5nU3luYyAtIEV4aXN0aW5nIHN5bmMgcm93IG9yIG51bGwuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IG11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gKi9cblxuLyoqXG4gKiBBcHBseSByZXN1bHQgcHJvZHVjZWQgYnkgcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNyZWF0ZWQgLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGVsZXRlZF0gLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBkZWxldGVkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IHJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gKi9cblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IG93bmluZyB0aGUgcmVzb3VyY2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogVHJhbnNwb3J0LXNhZmUgdmFsdWUgYWNjZXB0ZWQgaW4gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb24gcGF5bG9hZHMuXG4gKiBOZXN0ZWQgb2JqZWN0L2FycmF5IHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHNcbiAqIHJlY3Vyc2l2ZSBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgcGF5bG9hZCBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZVxuICovXG5cbi8qKlxuICogQXR0cmlidXRlIHBheWxvYWQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZT59IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWRcbiAqL1xuXG4vKipcbiAqIFZpcnR1YWwgc2V0dGVyIG1ldGhvZCBvbiBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlLlxuICogQHR5cGVkZWYgeyhhcmcxOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgYXJnMjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlKSA9PiAodm9pZCB8IFByb21pc2U8dm9pZD4pfSBGcm9udGVuZE1vZGVsUmVzb3VyY2VWaXJ0dWFsU2V0dGVyXG4gKi9cblxuLyoqXG4gKiBTdGF0aWMgaGVscGVycyB1c2VkIHdoZW4gY2hlY2tpbmcgd2hldGhlciBhIG1vZGVsLWxpa2UgcmVjZWl2ZXIgYWNjZXB0cyBhbiBhdHRyaWJ1dGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3NcbiAqIEBwcm9wZXJ0eSB7KGFyZzogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSByZXNvbHZlQXR0cmlidXRlTmFtZSAtIFJlc29sdmVzIGFsaWFzZXMgdG8gY2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZzE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXJnMjogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSBmaW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlIC0gTG9jYXRlcyBhIHNldHRlciBtZXRob2Qgb24gdGhlIHJlY2VpdmVyLlxuICovXG5cbi8qKlxuICogT3B0aW9ucyBwYXNzZWQgd2hpbGUgc2F2aW5nIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIG11dGF0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbYXR0YWNobWVudHNdIC0gVXBsb2FkZWQgYXR0YWNobWVudCBhdHRyaWJ1dGVzLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbH0gW2NvbnRyb2xsZXJdIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgbXV0YXRpb24uXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbbmVzdGVkQXR0cmlidXRlc10gLSBOZXN0ZWQgYXR0cmlidXRlcyBwYXlsb2FkLlxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkICYge2lkPzogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWUsIF9kZXN0cm95PzogYm9vbGVhbiwgYXR0cmlidXRlcz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQsIGF0dGFjaG1lbnRzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCwgbmVzdGVkQXR0cmlidXRlcz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeVxuICovXG5cbi8qKlxuICogTmFycm93cyBhbiB1bmJvdW5kIHJlc291cmNlIHJlZ2lzdHJ5IGVudHJ5IGF0IGZyYW1ld29yay1vd25lZCBjb25zdHJ1Y3Rpb25cbiAqIHNpdGVzIHdoZXJlIHRoZSBiYWNraW5nIGRhdGFiYXNlIG1vZGVsIGhhcyBhbHJlYWR5IGJlZW4gcmVzb2x2ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gVW5ib3VuZCByZXNvdXJjZSBjbGFzcy5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gUnVudGltZSBjb25zdHJ1Y3Rvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoUmVzb3VyY2VDbGFzcykge1xuICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKFJlc291cmNlQ2xhc3MpKVxufVxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tlbmQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBbVE1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPUV4dHJhY3Q8VE1vZGVsQ2xhc3MsIHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD5dXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZXh0ZW5kcyBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHtcbiAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhYmlsaXRpZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRhY2htZW50cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbWVtYmVyQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHNlcnZlciA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luYyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgc3RhdGljIFNoYXJlZFJlc291cmNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlY2xhcmF0aXZlIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCAoY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lcylcbiAgICogdXNlZCBhcyB0aGUgZGVmYXVsdCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNwZXJtaXR0ZWRQYXJhbXN9IGFuZFxuICAgKiBhcyB0aGUgcm91dGVkIHN5bmMgcmVwbGF5IHBlcm1pdC4gUmVzb2x2ZWQgdGhyb3VnaCB0aGUgc2hhcmVkIHJlc291cmNlXG4gICAqIGxpa2UgdGhlIG90aGVyIHN0YXRpYyByZXNvdXJjZSBjb25maWc6IGFuIHVuZGVjbGFyZWQgZW52aXJvbm1lbnQgbGlzdFxuICAgKiBmYWxscyBiYWNrIHRvIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LCB3aGlsZSBhbiBleHBsaWNpdCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucy5cbiAgICogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHdyaXRhYmxlQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzPFRNb2RlbENsYXNzPiB8IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzPFREYXRhYmFzZU1vZGVsQ2xhc3M+fSBhcmdzIC0gUmVzb3VyY2UgYXJncy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBzdXBlcih7XG4gICAgICBhYmlsaXR5OiBcImFiaWxpdHlcIiBpbiBhcmdzID8gYXJncy5hYmlsaXR5IDogdW5kZWZpbmVkLFxuICAgICAgY29udGV4dDogXCJjb250ZXh0XCIgaW4gYXJncyA/IGFyZ3MuY29udGV4dCB8fCB7fSA6IHt9LFxuICAgICAgbG9jYWxzOiBcImxvY2Fsc1wiIGluIGFyZ3MgPyBhcmdzLmxvY2FscyB8fCB7fSA6IHt9XG4gICAgfSlcblxuICAgIC8vIE5hcnJvd3MgdGhlIHN1YmNsYXNzIHN0YXRpYyBzaWRlIHRvIHRoZSBtb2RlbCBjbGFzcyBjYXJyaWVkIGJ5IHRoaXMgcmVzb3VyY2UgZ2VuZXJpYy5cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSAmIHtNb2RlbENsYXNzOiBUTW9kZWxDbGFzcyB8IHVuZGVmaW5lZCwgbW9kZWxDbGFzczogKCkgPT4gVE1vZGVsQ2xhc3N9fSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBkZWZhdWx0UmVzb3VyY2VDb25maWd1cmF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovICh7YXR0cmlidXRlczogW119KVxuXG4gICAgdGhpcy5jb250cm9sbGVyID0gXCJjb250cm9sbGVyXCIgaW4gYXJncyA/IGFyZ3MuY29udHJvbGxlciA6IHVuZGVmaW5lZFxuICAgIHRoaXMuY29uZmlndXJhdGlvblZhbHVlID0gXCJjb25maWd1cmF0aW9uXCIgaW4gYXJncyA/IGFyZ3MuY29uZmlndXJhdGlvbiA6IHVuZGVmaW5lZFxuICAgIC8vIE5hcnJvd3MgdGhlIGludGVybmFsIGNvbnRyb2xsZXIvc2hhcmVkLXJlc291cmNlIGNvbnN0cnVjdGlvbiBwYXRoIHRvIHRoZSByZXNvdXJjZSdzIGRlY2xhcmVkIG1vZGVsIGdlbmVyaWMuXG4gICAgdGhpcy5tb2RlbENsYXNzVmFsdWUgPSAvKiogQHR5cGUge1RNb2RlbENsYXNzfSAqLyAoXCJtb2RlbENsYXNzXCIgaW4gYXJncyA/IGFyZ3MubW9kZWxDbGFzcyA6IFJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpKVxuICAgIHRoaXMubW9kZWxOYW1lVmFsdWUgPSBcIm1vZGVsTmFtZVwiIGluIGFyZ3MgPyBhcmdzLm1vZGVsTmFtZSA6IHRoaXMubW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgdGhpcy5wYXJhbXNWYWx1ZSA9IFwicGFyYW1zXCIgaW4gYXJncyA/IGFyZ3MucGFyYW1zIDogdW5kZWZpbmVkXG4gICAgdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZSA9IFwicmVzb3VyY2VDb25maWd1cmF0aW9uXCIgaW4gYXJncyA/IGFyZ3MucmVzb3VyY2VDb25maWd1cmF0aW9uIDogZGVmYXVsdFJlc291cmNlQ29uZmlndXJhdGlvblxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29uZmlndXJlZCBzaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgc2hhcmVkUmVzb3VyY2VDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5TaGFyZWRSZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgc3RhdGljIHJlc291cmNlIGNvbmZpZyB2YWx1ZSBmcm9tIHRoZSBlbnZpcm9ubWVudCByZXNvdXJjZSBmaXJzdCxcbiAgICogdGhlbiBmcm9tIHRoZSBzaGFyZWQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7XCJhYmlsaXRpZXNcIiB8IFwiYXR0YWNobWVudHNcIiB8IFwiYXR0cmlidXRlc1wiIHwgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIgfCBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiIHwgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiY29tbWFuZHNcIiB8IFwibWVtYmVyQ29tbWFuZHNcIiB8IFwibW9kZWxOYW1lXCIgfCBcInByaW1hcnlLZXlcIiB8IFwicmVsYXRpb25zaGlwc1wiIHwgXCJzZXJ2ZXJcIiB8IFwic3luY1wiIHwgXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiIHwgXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIn0gbmFtZSAtIFN0YXRpYyBjb25maWcgcHJvcGVydHkgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJlc29sdmVkIGNvbmZpZyB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKG5hbWUpIHtcbiAgICBpZiAodGhpc1tuYW1lXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpc1tuYW1lXVxuXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgaWYgKFNoYXJlZFJlc291cmNlW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiBTaGFyZWRSZXNvdXJjZVtuYW1lXVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRyYW5zbGF0ZWQgYXR0cmlidXRlcyBmcm9tIGVudmlyb25tZW50IGFuZCBzaGFyZWQgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9IC0gVHJhbnNsYXRlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBmcm9udGVuZC1zYWZlIGF0dGFjaG1lbnQgZGVjbGFyYXRpb25zIGZyb20gdGhlIGJhY2tpbmcgbW9kZWwuXG4gICAqIFJlc291cmNlLWxldmVsIGRlY2xhcmF0aW9ucyByZW1haW4gYXMgYSBmYWxsYmFjayBmb3IgZnJvbnRlbmQtb25seSByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQ2xpZW50IGF0dGFjaG1lbnQgY29uZmlndXJhdGlvbiBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnRDb25maWd1cmF0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkQXR0YWNobWVudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPiB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImF0dGFjaG1lbnRzXCIpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gY29uZmlndXJlZEF0dGFjaG1lbnRzID8gey4uLmNvbmZpZ3VyZWRBdHRhY2htZW50c30gOiB7fVxuXG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHJldHVybiBhdHRhY2htZW50c1xuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIGRlZmluaXRpb25dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKSkpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRDb25maWcgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9ufSAqLyAoe3R5cGU6IGRlZmluaXRpb24udHlwZX0pXG5cbiAgICAgIGlmIChkZWZpbml0aW9uLnN5bmMpIGF0dGFjaG1lbnRDb25maWcuc3luYyA9IHsuLi5kZWZpbml0aW9uLnN5bmN9XG5cbiAgICAgIGF0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IGF0dGFjaG1lbnRDb25maWdcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0YWNobWVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByZXNvdXJjZSBpbnN0YW5jZSBmb3Igc2hhcmVkLXJlc291cmNlIGZhbGxiYWNrIGNhbGxzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsfSAtIFNoYXJlZCByZXNvdXJjZSBpbnN0YW5jZSB3aGVuIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBzaGFyZWRSZXNvdXJjZUluc3RhbmNlKCkge1xuICAgIGlmICh0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWVcblxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPn0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VDbGFzcygpKVxuXG4gICAgaWYgKCFTaGFyZWRSZXNvdXJjZSkge1xuICAgICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSBudWxsXG4gICAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWVcbiAgICB9XG5cbiAgICBpZiAoU2hhcmVkUmVzb3VyY2UgPT09IFJlc291cmNlQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtSZXNvdXJjZUNsYXNzLm5hbWV9LlNoYXJlZFJlc291cmNlIGNhbm5vdCBwb2ludCB0byBpdHNlbGYuYClcbiAgICB9XG5cbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZUNvbnN0cnVjdG9yID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKFNoYXJlZFJlc291cmNlKSlcbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IG5ldyBTaGFyZWRSZXNvdXJjZUNvbnN0cnVjdG9yKHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMuY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MoKSxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5tb2RlbE5hbWUoKSxcbiAgICAgIHBhcmFtczogdGhpcy5wYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuICAgIH0pXG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSBzaGFyZWRSZXNvdXJjZVxuXG4gICAgcmV0dXJuIHNoYXJlZFJlc291cmNlXG4gIH1cblxuICAvKipcbiAgICogQ2FsbHMgYSBzaGFyZWQtcmVzb3VyY2UgbWV0aG9kIG9ubHkgd2hlbiB0aGUgc2hhcmVkIHJlc291cmNlIG92ZXJyaWRlcyB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHBhcmFtIHt1bmtub3duW119IGFyZ3MgLSBNZXRob2QgYXJncy5cbiAgICogQHJldHVybnMge3tjYWxsZWQ6IGJvb2xlYW4sIHJlc3VsdDogdW5rbm93bn19IC0gU2hhcmVkIG1ldGhvZCBjYWxsIHJlc3VsdC5cbiAgICovXG4gIGNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKSB7XG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cblxuICAgIGNvbnN0IG1ldGhvZE93bmVyID0gcHJvdG90eXBlT3duZXJGb3JNZXRob2Qoc2hhcmVkUmVzb3VyY2UsIG1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIW1ldGhvZE93bmVyIHx8IG1ldGhvZE93bmVyID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZSB8fCBtZXRob2RPd25lciA9PT0gQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZS5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybiB7Y2FsbGVkOiBmYWxzZSwgcmVzdWx0OiB1bmRlZmluZWR9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIHJldHVybiB7Y2FsbGVkOiB0cnVlLCByZXN1bHQ6IG1ldGhvZC5hcHBseShzaGFyZWRSZXNvdXJjZSwgYXJncyl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaGFyZWQgbWV0aG9kIHJlc3VsdCBvciBhIGZhbGxiYWNrIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gU2hhcmVkIG1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIFNoYXJlZCBtZXRob2QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBSZXN1bHR9IGZhbGxiYWNrIC0gRmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtSZXN1bHR9IC0gU2hhcmVkIG9yIGZhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlTWV0aG9kT3IobWV0aG9kTmFtZSwgYXJncywgZmFsbGJhY2spIHtcbiAgICBjb25zdCBzaGFyZWRSZXN1bHQgPSB0aGlzLmNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKVxuXG4gICAgaWYgKHNoYXJlZFJlc3VsdC5jYWxsZWQpIHJldHVybiAvKiogQHR5cGUge1Jlc3VsdH0gKi8gKHNoYXJlZFJlc3VsdC5yZXN1bHQpXG5cbiAgICByZXR1cm4gZmFsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgbWV0aG9kIG9uIHRoaXMgcmVzb3VyY2Ugb3IgaXRzIHNoYXJlZCBmYWxsYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ttZXRob2Q6ICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24sIHJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPn0gfCBudWxsfSAtIFJlc29sdmVkIG1ldGhvZCBhbmQgcmVjZWl2ZXIuXG4gICAqL1xuICByZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lKSB7XG4gICAgY29uc3Qgb3duTWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpKVttZXRob2ROYW1lXVxuXG4gICAgaWYgKHR5cGVvZiBvd25NZXRob2QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbWV0aG9kOiAvKiogQHR5cGUgeyguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd259ICovIChvd25NZXRob2QpLFxuICAgICAgICByZXNvdXJjZTogdGhpc1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlKClcblxuICAgIGlmICghc2hhcmVkUmVzb3VyY2UpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzaGFyZWRNZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc2hhcmVkUmVzb3VyY2UpKVttZXRob2ROYW1lXVxuXG4gICAgaWYgKHR5cGVvZiBzaGFyZWRNZXRob2QgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBtZXRob2Q6IC8qKiBAdHlwZSB7KC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bn0gKi8gKHNoYXJlZE1ldGhvZCksXG4gICAgICByZXNvdXJjZTogc2hhcmVkUmVzb3VyY2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhYmlsaXRpZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFiaWxpdGllcygpIHtcbiAgICB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhYmlsaXRpZXNcIiwgW10sICgpID0+IHVuZGVmaW5lZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHR5cGVkIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAtIENvbnRyb2xsZXIgaW5zdGFuY2Ugd2l0aCBmcm9udGVuZC1tb2RlbCBoZWxwZXJzLlxuICAgKi9cbiAgdHlwZWRDb250cm9sbGVySW5zdGFuY2UoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gKi8gKHRoaXMuY29udHJvbGxlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBTdGF0aWMgcmVzb3VyY2UgY29uZmlnIChyYXcgdXNlciBpbnB1dCBzaGFwZTsgY29uc3VtZXJzIG5vcm1hbGl6ZSkuXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImF0dHJpYnV0ZXNcIilcbiAgICBjb25zdCBhYmlsaXRpZXMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhYmlsaXRpZXNcIilcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHRoaXMuYXR0YWNobWVudENvbmZpZ3VyYXRpb25zKClcbiAgICBjb25zdCBjb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImNvbW1hbmRzXCIpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIilcbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIilcbiAgICBjb25zdCBjb2xsZWN0aW9uQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJjb2xsZWN0aW9uQ29tbWFuZHNcIilcbiAgICBjb25zdCBtZW1iZXJDb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1lbWJlckNvbW1hbmRzXCIpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibW9kZWxOYW1lXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInByaW1hcnlLZXlcIilcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwicmVsYXRpb25zaGlwc1wiKVxuICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInNlcnZlclwiKVxuICAgIGNvbnN0IHN5bmMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzeW5jXCIpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovXG4gICAgY29uc3QgY29uZmlnID0ge1xuICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBzdHJpbmdbXX0gKi8gKGF0dHJpYnV0ZXMgfHwgW10pXG4gICAgfVxuXG4gICAgaWYgKGFiaWxpdGllcykgY29uZmlnLmFiaWxpdGllcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhYmlsaXRpZXMpXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBjb25maWcuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChjb21tYW5kcykgY29uZmlnLmNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbW1hbmRzKVxuICAgIGlmIChidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzKVxuICAgIGlmIChidWlsdEluTWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKVxuICAgIGlmIChjb2xsZWN0aW9uQ29tbWFuZHMpIGNvbmZpZy5jb2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoY29sbGVjdGlvbkNvbW1hbmRzKVxuICAgIGlmIChtZW1iZXJDb21tYW5kcykgY29uZmlnLm1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKG1lbWJlckNvbW1hbmRzKVxuICAgIGlmIChtb2RlbE5hbWUpIGNvbmZpZy5tb2RlbE5hbWUgPSAvKiogQHR5cGUge3N0cmluZ30gKi8gKG1vZGVsTmFtZSlcbiAgICBpZiAocHJpbWFyeUtleSkgY29uZmlnLnByaW1hcnlLZXkgPSAvKiogQHR5cGUge3N0cmluZyB8IHN0cmluZ1tdfSAqLyAocHJpbWFyeUtleSlcbiAgICBpZiAocmVsYXRpb25zaGlwcykgY29uZmlnLnJlbGF0aW9uc2hpcHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAocmVsYXRpb25zaGlwcylcbiAgICBpZiAoc2VydmVyKSBjb25maWcuc2VydmVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlcnZlckNvbmZpZ3VyYXRpb259ICovIChzZXJ2ZXIpXG4gICAgaWYgKHN5bmMgIT09IHVuZGVmaW5lZCkgY29uZmlnLnN5bmMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFufSAqLyAoc3luYylcblxuICAgIHJldHVybiBjb25maWdcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY2xpZW50LWZhY2luZyByZXNvdXJjZSBwcmltYXJ5IGtleSBmcm9tIGV4cGxpY2l0IHJlc291cmNlIGNvbmZpZyBvciB0aGUgYmFja2luZyBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBSZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBDbGllbnQtZmFjaW5nIHByaW1hcnkga2V5LlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVkUHJpbWFyeUtleShyZXNvdXJjZUNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAocmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkpIHJldHVybiByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleVxuICAgIGlmICghdGhpcy5Nb2RlbENsYXNzKSByZXR1cm4gXCJpZFwiXG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLm1vZGVsQ2xhc3MoKSlcbiAgICBjb25zdCBtb2RlbFByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkobW9kZWxQcmltYXJ5S2V5KVxuICAgICAgPyBtb2RlbFByaW1hcnlLZXkubWFwKChjb2x1bW5OYW1lKSA9PiBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbHVtbk5hbWUpIHx8IGNvbHVtbk5hbWUpXG4gICAgICA6IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobW9kZWxQcmltYXJ5S2V5KSB8fCBtb2RlbFByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IC0gQ29udHJvbGxlciBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICBpZiAoIXRoaXMuY29udHJvbGxlcikgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIGluc3RhbmNlLmApXG5cbiAgICByZXR1cm4gdGhpcy5jb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb246IHRoZSBjb250cm9sbGVyJ3Mgd2hlbiB0aGUgcmVzb3VyY2VcbiAgICogc2VydmVzIGEgY29udHJvbGxlciByZXF1ZXN0LCBvdGhlcndpc2UgdGhlIGNvbnN0cnVjdG9yLWluamVjdGVkXG4gICAqIGNvbmZpZ3VyYXRpb24gKGZvciBleGFtcGxlIGEgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCdzIHJlc291cmNlKS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udHJvbGxlcikgcmV0dXJuIHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgaWYgKHRoaXMuY29uZmlndXJhdGlvblZhbHVlKSByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uVmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgY29udHJvbGxlciBvciBhbiBpbmplY3RlZCBjb25maWd1cmF0aW9uLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1RNb2RlbENsYXNzfSAtIE1vZGVsIGNsYXNzLlxuICAgKi9cbiAgbW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxDbGFzc1ZhbHVlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIG1vZGVsIGNsYXNzLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc1ZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGF0YWJhc2UgbW9kZWwgY2xhc3MgdXNlZCBieSBzZXJ2ZXItb25seSByZXNvdXJjZSBvcGVyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7VERhdGFiYXNlTW9kZWxDbGFzc30gLSBEYXRhYmFzZSBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGRhdGFiYXNlTW9kZWxDbGFzcygpIHtcbiAgICAvLyBOYXJyb3dzIHRoZSBwb3J0YWJsZSByZXNvdXJjZSBnZW5lcmljIGF0IHRoZSBleHBsaWNpdCBiYWNrZW5kLW9wZXJhdGlvbiBib3VuZGFyeS5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtURGF0YWJhc2VNb2RlbENsYXNzfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcy5tb2RlbENsYXNzKCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZWQgbW9kZWwgY2xhc3MgZm9yIGF1dGhvcml6YXRpb24gaGVscGVycy5cbiAgICogQHJldHVybnMge1RNb2RlbENsYXNzfSAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqL1xuICByZXF1aXJlZE1vZGVsQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1vZGVsIG5hbWUuXG4gICAqL1xuICBtb2RlbE5hbWUoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsTmFtZVZhbHVlKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIG1vZGVsIG5hbWUuYClcblxuICAgIHJldHVybiB0aGlzLm1vZGVsTmFtZVZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gLSBQYXJhbXMuXG4gICAqL1xuICBwYXJhbXMoKSB7IHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAqLyAodGhpcy5wYXJhbXNWYWx1ZSB8fCBzdXBlci5wYXJhbXMoKSB8fCB7fSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIFJlc291cmNlIGNvbmZpZyAobm9ybWFsaXplZCBhdCBydW50aW1lOyByYXcgZHVyaW5nIGVhcmx5IGJvb3RzdHJhcCkuXG4gICAqL1xuICByZXNvdXJjZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uYClcblxuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIFJhaWxzLXN0cm9uZy1wYXJhbXMgLyBhcGlfbWFrZXItc3R5bGUgcGVybWl0IHNwZWMgZGVjbGFyaW5nXG4gICAqIHdoaWNoIGF0dHJpYnV0ZXMgYW5kIG5lc3RlZCBhdHRyaWJ1dGVzIGFyZSB3cml0YWJsZSBmb3IgdGhlIGN1cnJlbnRcbiAgICogcmVxdWVzdC4gU3VibWl0dGluZyBhbiBhdHRyaWJ1dGUgb3IgbmVzdGVkLXJlbGF0aW9uc2hpcCBrZXkgdGhhdCBpc1xuICAgKiBub3QgcGVybWl0dGVkIHJhaXNlcyBhbiBlcnJvciBhbmQgZmFpbHMgdGhlIHdyaXRlLlxuICAgKlxuICAgKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBmbGF0IGFycmF5IHRoYXQgbWl4ZXM6XG4gICAqICAgLSBgXCJhdHRyaWJ1dGVOYW1lXCJgIHN0cmluZ3MgZm9yIHBsYWluIGF0dHJpYnV0ZSB3cml0ZXNcbiAgICogICAtIGB7PHJlbGF0aW9uc2hpcE5hbWU+QXR0cmlidXRlczogWy4uLl19YCBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZVxuICAgKiAgICAgaXMgaXRzZWxmIGEgcGVybWl0IHNwZWMgZm9yIHRoZSBuZXN0ZWQgcmVsYXRpb25zaGlwXG4gICAqXG4gICAqIFRoaXMgbWF0Y2hlcyBSYWlscyBzdHJvbmdfcGFyYW1zIChgcGVybWl0KDpmaXJzdF9uYW1lLCA6bGFzdF9uYW1lLFxuICAgKiBjb250YWN0X2F0dHJpYnV0ZXM6IFs6ZW1haWwsIGRldGFpbHNfYXR0cmlidXRlczogWzpkZXRhaWxdXSlgKSBhbmRcbiAgICogdGhlIGFwaV9tYWtlciBzaXN0ZXIgcHJvamVjdC4gSW5jbHVkZSBgXCJfZGVzdHJveVwiYCBpbnNpZGUgYSBuZXN0ZWRcbiAgICogcGVybWl0IHRvIGFsbG93IGBfZGVzdHJveTogdHJ1ZWAgZW50cmllcyBmb3IgdGhhdCByZWxhdGlvbnNoaXAg4oCUXG4gICAqIHRoZSBtb2RlbCBtdXN0IGFsc28gZGVjbGFyZSBgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IobmFtZSxcbiAgICoge2FsbG93RGVzdHJveTogdHJ1ZX0pYCBmb3IgdGhlIGRlc3Ryb3kgdG8gYmUgYXBwbGllZC5cbiAgICpcbiAgICogRXhhbXBsZTpcbiAgICpcbiAgICogICBjbGFzcyBQcm9qZWN0UmVzb3VyY2UgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHtcbiAgICogICAgIHBlcm1pdHRlZFBhcmFtcyhhcmcpIHtcbiAgICogICAgICAgcmV0dXJuIFtcbiAgICogICAgICAgICBcIm5hbWVcIixcbiAgICogICAgICAgICBcImRlc2NyaXB0aW9uXCIsXG4gICAqICAgICAgICAge3Rhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIixcbiAgICogICAgICAgICAgIHtzdWJ0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdfVxuICAgKiAgICAgICAgIF19XG4gICAqICAgICAgIF1cbiAgICogICAgIH1cbiAgICogICB9XG4gICAqXG4gICAqIERlZmF1bHQgaW1wbGVtZW50YXRpb24gcmV0dXJucyB0aGUgZGVjbGFyZWRcbiAgICoge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uud3JpdGFibGVBdHRyaWJ1dGVzfSBwZXJtaXQgbGlzdCwgb3IgYFtdYFxuICAgKiDigJQgbm90aGluZyBwZXJtaXR0ZWQg4oCUIHdpdGhvdXQgYSBkZWNsYXJlZCBsaXN0LiBTdWJjbGFzc2VzIG92ZXJyaWRlIHRvXG4gICAqIGN1c3RvbWl6ZTsgYW4gZXhwbGljaXQgb3ZlcnJpZGUgYWx3YXlzIHdpbnMuXG4gICAqIEBwYXJhbSB7e2FjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiLCBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGFiaWxpdHk/OiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCwgbG9jYWxzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ10gLSBSZXF1ZXN0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBlcm1pdCBzcGVjLlxuICAgKi9cbiAgcGVybWl0dGVkUGFyYW1zKGFyZykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJwZXJtaXR0ZWRQYXJhbXNcIiwgW2FyZ10sICgpID0+IHtcbiAgICAgIHZvaWQgYXJnXG5cbiAgICAgIHJldHVybiB0aGlzLmRlY2xhcmVkV3JpdGFibGVBdHRyaWJ1dGVzKCkgPz8gW11cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkZWNsYXJlZCB3cml0YWJsZS1hdHRyaWJ1dGUgcGVybWl0IGxpc3QgZnJvbSB0aGUgZW52aXJvbm1lbnRcbiAgICogcmVzb3VyY2UgZmlyc3QsIHRoZW4gdGhlIHNoYXJlZCByZXNvdXJjZSDigJQgbWlycm9yaW5nIGhvdyB0aGUgb3RoZXJcbiAgICogc3RhdGljIHJlc291cmNlIGNvbmZpZyByZXNvbHZlcy4gQW4gZXhwbGljaXQgZW52aXJvbm1lbnQgZGVjbGFyYXRpb25cbiAgICogKGluY2x1ZGluZyBgbnVsbGApIHdpbnMgb3ZlciB0aGUgc2hhcmVkIHJlc291cmNlJ3MgbGlzdC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gRGVjbGFyZWQgcGVybWl0IGxpc3Qgb3IgbnVsbCB3aGVuIHVuZGVjbGFyZWQuXG4gICAqL1xuICBkZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgcGVybWl0dGVkQXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7c3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwid3JpdGFibGVBdHRyaWJ1dGVzXCIpKVxuXG4gICAgcmV0dXJuIHBlcm1pdHRlZEF0dHJpYnV0ZXMgPz8gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgY2xpZW50LXNhZmUgZXJyb3IgdGhyb3duIGZvciBhIGZhaWxlZCB3cml0YWJsZS1hdHRyaWJ1dGUgdmFsaWRhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBIdW1hbi1yZWFkYWJsZSB2YWxpZGF0aW9uIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e2NhdXNlPzogRXJyb3IsIGNvZGU6IHN0cmluZ319IGRldGFpbHMgLSBTdGFibGUgbWFjaGluZS1yZWFkYWJsZSBjb2RlIGFuZCBvcHRpb25hbCBjYXVzZS5cbiAgICogQHJldHVybnMge0Vycm9yfSBDbGllbnQtc2FmZSBlcnJvci5cbiAgICovXG4gIHdyaXRhYmxlQXR0cmlidXRlRXJyb3IobWVzc2FnZSwge2NhdXNlLCBjb2RlfSkge1xuICAgIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKG1lc3NhZ2UsIGNhdXNlID8ge2NhdXNlLCBjb2RlfSA6IHtjb2RlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRob3JpemVzIG9uZSByb3V0ZWQgc3luYyByZXBsYXkgbXV0YXRpb24gYmVmb3JlIGl0IGlzIGFwcGxpZWQuXG4gICAqIERlZmF1bHRzIHRvIGFsbG93aW5nIGV2ZXJ5IG11dGF0aW9uOyByZWNvcmQtbGV2ZWwgYXV0aG9yaXphdGlvbiBzdGlsbFxuICAgKiBhcHBsaWVzIHRocm91Z2gge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UjZmluZFN5bmNSZWNvcmR9IHNjb3BpbmdcbiAgICogYW5kIHRoZSBjcmVhdGUgbWVtYmVyc2hpcCBjaGVjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb24+fSBBdXRob3JpemF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGF1dGhvcml6ZVN5bmNNdXRhdGlvbih7Y29udGV4dCwgbXV0YXRpb259KSB7XG4gICAgdm9pZCBjb250ZXh0XG4gICAgdm9pZCBtdXRhdGlvblxuXG4gICAgcmV0dXJuIHthbGxvd2VkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHBlci1zeW5jIGZhaWx1cmUgcmVhc29uIHJlcG9ydGVkIHdoZW4gYSByb3V0ZWQgc3luYyBtdXRhdGlvblxuICAgKiBmYWlscyByZWNvcmQtbGV2ZWwgYXV0aG9yaXphdGlvbi4gRGVmYXVsdHMgdG8gbnVsbCwgd2hpY2ggcmVwb3J0cyB0aGVcbiAgICogZ2VuZXJpYyBcImFjY2Vzcy1kZW5pZWRcIiByZWFzb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBhcmdzLmFjdGlvbiAtIERlbmllZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gU3RhYmxlIGZhaWx1cmUgcmVhc29uIGNvZGUgb3IgbnVsbCBmb3IgdGhlIGdlbmVyaWMgZGVmYXVsdC5cbiAgICovXG4gIHN5bmNBdXRob3JpemF0aW9uRmFpbHVyZVJlYXNvbih7YWN0aW9uLCBtdXRhdGlvbn0pIHtcbiAgICB2b2lkIGFjdGlvblxuICAgIHZvaWQgbXV0YXRpb25cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIGV4aXN0aW5nIHJlY29yZCB0YXJnZXRlZCBieSBhIHJvdXRlZCBzeW5jIHJlcGxheSBtdXRhdGlvbi5cbiAgICogRGVmYXVsdHMgdG8gYW4gYGFjY2Vzc2libGVGb3JgIGxvb2t1cCBieSBwcmltYXJ5IGtleSB0aHJvdWdoIHRoZVxuICAgKiByZXNvdXJjZSdzIG5vcm1hbGl6ZWQgYWJpbGl0eSBhY3Rpb24gZm9yIHVwZGF0ZSAob3IgZGVzdHJveSBmb3IgZGVsZXRlXG4gICAqIG11dGF0aW9ucyksIGZhbGxpbmcgYmFjayB0byBhbiB1bnNjb3BlZCBsb29rdXAgd2l0aG91dCBhbiBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IFthcmdzLmFiaWxpdHldIC0gQWJpbGl0eSBvdmVycmlkZS4gRGVmYXVsdHMgdG8gdGhlIHJlc291cmNlIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZm9yRGVsZXRlXSAtIFdoZXRoZXIgdGhlIGxvb2t1cCBpcyBmb3IgYSBkZWxldGUgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSBFeGlzdGluZyByZWNvcmQgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIGZpbmRTeW5jUmVjb3JkKHthYmlsaXR5ID0gdGhpcy5hYmlsaXR5LCBmb3JEZWxldGUgPSBmYWxzZSwgbXV0YXRpb259KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMuZGF0YWJhc2VNb2RlbENsYXNzKClcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gTW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuc3luY0FiaWxpdHlBY3Rpb24oZm9yRGVsZXRlID8gXCJkZXN0cm95XCIgOiBcInVwZGF0ZVwiKSwgYWJpbGl0eSlcbiAgICAgIDogTW9kZWxDbGFzcy53aGVyZSh7fSlcblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyh0aGlzLnByaW1hcnlLZXkoKSwgbXV0YXRpb24ucmVzb3VyY2VJZCkpXG4gIH1cblxuICAvKipcbiAgICogTWFwcyBhIHJhdyBzeW5jIGFjdGlvbiB0byB0aGUgcmVzb3VyY2UncyBub3JtYWxpemVkIGFiaWxpdHkgYWN0aW9uIHdoZW5cbiAgICogdGhlIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZGVjbGFyZXMgYW4gYWJpbGl0aWVzIG1hcHBpbmcsIG90aGVyd2lzZSB0aGVcbiAgICogcmF3IGFjdGlvbiBuYW1lIGlzIHVzZWQgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gYWN0aW9uIC0gUmF3IHN5bmMgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBYmlsaXR5IGFjdGlvbi5cbiAgICovXG4gIHN5bmNBYmlsaXR5QWN0aW9uKGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWU/LmFiaWxpdGllc1xuXG4gICAgaWYgKGFiaWxpdGllcyAmJiB0eXBlb2YgYWJpbGl0aWVzID09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoYWJpbGl0aWVzKSkge1xuICAgICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoYWJpbGl0aWVzKVthY3Rpb25dXG5cbiAgICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiA9PSBcInN0cmluZ1wiICYmIGFiaWxpdHlBY3Rpb24ubGVuZ3RoID4gMCkgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gYWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogRnVsbCBlc2NhcGUgaGF0Y2ggZm9yIHJvdXRlZCBzeW5jIG11dGF0aW9uIGFwcGxpY2F0aW9uLiBSZXR1cm5pbmcgYVxuICAgKiBub24tbnVsbCByZXN1bHQgcmVwbGFjZXMgdGhlIHdob2xlIGRlZmF1bHQgYXBwbHkgZmxvdyAoYXV0aG9yaXphdGlvbixcbiAgICogcmVjb3JkIGxvb2t1cCwgbm9ybWFsaXphdGlvbiBhbmQgc2F2ZSkgd2l0aCB0aGUgcmV0dXJuZWQgYXBwbHkgcmVzdWx0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxBcHBseVN5bmNBcmdzfSBhcmdzIC0gQXBwbHkgYXJncy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHQgfCBudWxsIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0IHwgbnVsbD59IEFwcGx5IHJlc3VsdCBvciBudWxsIGZvciB0aGUgZGVmYXVsdCBmbG93LlxuICAgKi9cbiAgYXBwbHlTeW5jKGFyZ3MpIHtcbiAgICB2b2lkIGFyZ3NcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBhIHJvdXRlZCBzeW5jIG11dGF0aW9uIHdhcyBhcHBsaWVkLiBSZXR1cm5lZCBlbnRyaWVzIGFyZVxuICAgKiBtZXJnZWQgaW50byB0aGUgYXBwbHkgcmVzdWx0LCByZWFjaGluZyBwZXJzaXN0RXh0cmFBdHRyaWJ1dGVzIGFuZFxuICAgKiBicm9hZGNhc3RzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLmNyZWF0ZWQgLSBXaGV0aGVyIHRoZSByZWNvcmQgd2FzIGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gYXJncy5yZWNvcmQgLSBBcHBsaWVkIHJlY29yZCBvciBudWxsLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBFeHRyYSBhcHBseS1yZXN1bHQgZW50cmllcy5cbiAgICovXG4gIGFmdGVyU3luY0FwcGx5KHtjb250ZXh0LCBjcmVhdGVkLCBtdXRhdGlvbiwgcmVjb3JkfSkge1xuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgY3JlYXRlZFxuICAgIHZvaWQgbXV0YXRpb25cbiAgICB2b2lkIHJlY29yZFxuXG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBjcmVhdGUgYXR0cmlidXRlcyBiZWZvcmUgcGVybWlzc2lvbiBmaWx0ZXJpbmcgYW5kIHNhdmluZy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkPn0gLSBOb3JtYWxpemVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwibm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlc1wiLCBbYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgb3B0aW9uc1xuXG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyB1cGRhdGUgYXR0cmlidXRlcyBiZWZvcmUgcGVybWlzc2lvbiBmaWx0ZXJpbmcgYW5kIHNhdmluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkPn0gLSBOb3JtYWxpemVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBub3JtYWxpemVVcGRhdGVBdHRyaWJ1dGVzKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcIm5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXNcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBvcHRpb25zXG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBjcmVhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTmV3IG1vZGVsIGJlZm9yZSBhc3NpZ25tZW50L3NhdmUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlQ3JlYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZUNyZWF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBjcmVhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQ3JlYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBhZnRlckNyZWF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlckNyZWF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsIGJlZm9yZSBhc3NpZ25tZW50L3NhdmUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlVXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZVVwZGF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gVXBkYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBhZnRlclVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlclVwZGF0ZVwiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIGF0dHJpYnV0ZXNcbiAgICAgIHZvaWQgb3B0aW9uc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBiZWZvcmUgZGVzdHJveS5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVEZXN0cm95KG1vZGVsKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZURlc3Ryb3lcIiwgW21vZGVsXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIERlc3Ryb3llZCBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBhZnRlckRlc3Ryb3kobW9kZWwpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJEZXN0cm95XCIsIFttb2RlbF0sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFdyYXBzIGNyZWF0ZS91cGRhdGUvZGVzdHJveSByZXNvdXJjZSBtdXRhdGlvbnMuXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBUcmFuc2FjdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gTXV0YXRpb24gYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsIC0gTXV0YXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJlc3VsdD59IGFyZ3MuY2FsbGJhY2sgLSBNdXRhdGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5NdXRhdGlvblRyYW5zYWN0aW9uKHthY3Rpb24sIG1vZGVsLCBjYWxsYmFja30pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwicnVuTXV0YXRpb25UcmFuc2FjdGlvblwiLCBbe2FjdGlvbiwgbW9kZWwsIGNhbGxiYWNrfV0sIGFzeW5jICgpID0+IHtcbiAgICAgIHZvaWQgYWN0aW9uXG4gICAgICB2b2lkIG1vZGVsXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBQcmltYXJ5IGtleS5cbiAgICovXG4gIHByaW1hcnlLZXkoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuXG4gICAgcmV0dXJuIFJlc291cmNlQ2xhc3MucmVzb2x2ZWRQcmltYXJ5S2V5KHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdXRob3JpemVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbn0gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXV0aG9yaXplZFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gQXV0aG9yaXphdGlvbiBxdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbiwgb3B0aW9ucykge1xuICAgIC8vIE5hcnJvd3MgdGhlIGNvbnRyb2xsZXIgcXVlcnkgdG8gdGhpcyByZXNvdXJjZSdzIG1vZGVsIGNsYXNzLlxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnkoYWN0aW9uLCBvcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gLSBGcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeS5cbiAgICovXG4gIGluZGV4UXVlcnkob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gKi8gKHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsSW5kZXhRdWVyeSh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgcmVzb3VyY2U6IHRoaXNcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHBhZ2luYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnaW5hdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb259IGFyZ3MucGFnaW5hdGlvbiAtIFBhZ2luYXRpb24gcGFyYW1zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uKHtjb250cm9sbGVyLCBwYWdpbmF0aW9uLCBxdWVyeX0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFBhZ2luYXRpb24oe3BhZ2luYXRpb24sIHF1ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNlYXJjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0gYXJncy5zZWFyY2ggLSBTZWFyY2ggcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoKHtjb250cm9sbGVyLCBxdWVyeSwgc2VhcmNofSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU29ydCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU29ydH0gYXJncy5zb3J0IC0gU29ydCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTb3J0KHtjb250cm9sbGVyLCBxdWVyeSwgc29ydH0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNvcnQoe3F1ZXJ5LCBzb3J0fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIHBsdWNrLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHBsdWNrIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzUGx1Y2soYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykucmVjb3JkcyA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUucmVjb3Jkc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgY291bnQuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY291bnQgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNDb3VudChhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5yZWNvcmRzID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5yZWNvcmRzIHx8XG4gICAgICBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykuY291bnQgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLmNvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgdm9pZCB8IFByb21pc2U8Ym9vbGVhbiB8IHZvaWQ+fSAtIENvbnRpbnVlIHByb2Nlc3NpbmcgdW5sZXNzIGZhbHNlLlxuICAgKi9cbiAgYmVmb3JlQWN0aW9uKGFjdGlvbikge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVBY3Rpb25cIiwgW2FjdGlvbl0sICgpID0+IHtcbiAgICAgIHZvaWQgYWN0aW9uXG5cbiAgICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHQuXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIFJlY29yZHMgZm9yIGluZGV4IGFjdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29yZHMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5kZXhRdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5kZXggcXVlcnkgb3B0aW9ucyBmb3IgY291bnQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gLSBJbmRleCBxdWVyeSBvcHRpb25zIGZvciBjb3VudC5cbiAgICovXG4gIGNvdW50SW5kZXhRdWVyeU9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZWNvcmRzIGNvdW50IGZvciBpbmRleCBhY3Rpb24uXG4gICAqL1xuICBhc3luYyBjb3VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KHRoaXMuY291bnRJbmRleFF1ZXJ5T3B0aW9ucygpKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gTG9jYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmQoYWN0aW9uLCBpZCkge1xuICAgIGxldCBxdWVyeSA9IHRoaXMuYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICBjb25zdCBwcmVsb2FkID0gYWN0aW9uID09PSBcImZpbmRcIiA/IHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsUHJlbG9hZCgpIDogbnVsbFxuXG4gICAgaWYgKHByZWxvYWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyh0aGlzLnByaW1hcnlLZXkoKSwgaWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBDcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQ3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRTcGxpdCA9IHRoaXMuX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsKVxuICAgIGNvbnN0IHBlcm1pdCA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwiY3JlYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiBub3JtYWxpemVkQXR0cmlidXRlc30pKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKE1vZGVsQ2xhc3MucHJvdG90eXBlLCBNb2RlbENsYXNzLCBhdHRhY2htZW50U3BsaXQuYXR0cmlidXRlcywgdGhpcywgcGVybWl0LmF0dHJpYnV0ZXMpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJjcmVhdGVcIixcbiAgICAgIG1vZGVsLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWZvcmVDcmVhdGUobW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgICAgICBjb25zdCBzYXZlZE1vZGVsID0gYXdhaXQgdGhpcy5fc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnM6IHsuLi5vcHRpb25zLCBhdHRhY2htZW50czogYXR0YWNobWVudFNwbGl0LmF0dGFjaG1lbnRzfSwgcGVybWl0fSlcblxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyQ3JlYXRlKHNhdmVkTW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuXG4gICAgICAgIHJldHVybiBzYXZlZE1vZGVsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB1bmF1dGhvcml6ZWQgY3JlYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDbGVhbnVwIGFmdGVyIGZhaWxlZCBhdXRob3JpemF0aW9uLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlVW5hdXRob3JpemVkQ3JlYXRlZE1vZGVsKG1vZGVsKSB7XG4gICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIFVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBVcGRhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwsIG1vZGVsLmdldE1vZGVsQ2xhc3MoKSwgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlVXBkYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclVwZGF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgYSBtb2RlbCBhbmQgYXBwbGllcyBuZXN0ZWQgYXR0cmlidXRlcyBpbiBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7e2ZpbHRlcmVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG1vZGVsOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgb3B0aW9uczogRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnMsIHBlcm1pdDoge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19fSBhcmdzIC0gU2F2ZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBTYXZlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9ucywgcGVybWl0fSkge1xuICAgIGF3YWl0IHRoaXMuZGF0YWJhc2VNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKG1vZGVsLCBmaWx0ZXJlZClcbiAgICAgIHRoaXMuX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgICBpZiAob3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhtb2RlbCwgb3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmNvbnRyb2xsZXIgfHwgbnVsbCwgcGVybWl0KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtb2RlbC5zYXZlKClcblxuICAgICAgaWYgKG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMobW9kZWwsIG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcywgb3B0aW9ucy5jb250cm9sbGVyIHx8IG51bGwsIHBlcm1pdClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fcHJlbG9hZE5lc3RlZFdyaXRhYmxlUmVsYXRpb25zaGlwcyhtb2RlbCwgcGVybWl0KVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBhdHRyaWJ1dGVzIHRvIGEgbW9kZWwsIHVzaW5nIHZpcnR1YWwgc2V0dGVycyBvbiB0aGUgcmVzb3VyY2Ugd2hlbiBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhtb2RlbCwgYXR0cmlidXRlcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGRpcmVjdEF0dHJpYnV0ZXMgPSB7fVxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldChSZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW10pXG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUobmFtZSl9QXR0cmlidXRlYFxuICAgICAgY29uc3QgcmVzb3VyY2VTZXR0ZXIgPSB0aGlzLnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgICAgaWYgKHJlc291cmNlU2V0dGVyKSB7XG4gICAgICAgIGF3YWl0IHJlc291cmNlU2V0dGVyLm1ldGhvZC5jYWxsKHJlc291cmNlU2V0dGVyLnJlc291cmNlLCBtb2RlbCwgdmFsdWUpXG4gICAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKG5hbWUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpcmVjdEF0dHJpYnV0ZXNbbmFtZV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkaXJlY3RBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBtb2RlbC5hc3NpZ24oZGlyZWN0QXR0cmlidXRlcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIGF0dGFjaG1lbnQtbmFtZWQgYXR0cmlidXRlcyBpbnRvIHRoZSBhdHRhY2htZW50IHBheWxvYWQgd2hpbGUgcHJlc2VydmluZyBsZWdhY3kgY2FsbGVyc1xuICAgKiB0aGF0IHN1Ym1pdHRlZCBhdHRhY2htZW50cyBhcyBub3JtYWwgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gRXhwbGljaXQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXR0YWNobWVudHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9fSBBdHRyaWJ1dGVzIHdpdGggYXR0YWNobWVudCBrZXlzIHJlbW92ZWQgYW5kIG1lcmdlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBfZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzKSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gdGhpcy5tb2RlbENsYXNzKCkuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dGFjaG1lbnREZWZpbml0aW9ucykpXG5cbiAgICBpZiAoYXR0YWNobWVudE5hbWVzLnNpemUgPT09IDApIHJldHVybiB7YXR0cmlidXRlcywgYXR0YWNobWVudHN9XG5cbiAgICBpZiAoYXR0YWNobWVudHMgIT09IG51bGwgJiYgIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVndWxhckF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gKi9cbiAgICBsZXQgbWVyZ2VkQXR0YWNobWVudHMgPSBhdHRhY2htZW50cyA/IHsuLi5hdHRhY2htZW50c30gOiBudWxsXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0YWNobWVudE5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICByZWd1bGFyQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWVyZ2VkQXR0YWNobWVudHMpIG1lcmdlZEF0dGFjaG1lbnRzID0ge31cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobWVyZ2VkQXR0YWNobWVudHMsIGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAnJHthdHRyaWJ1dGVOYW1lfScgd2FzIHN1Ym1pdHRlZCBpbiBib3RoIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzLmApXG4gICAgICB9XG5cbiAgICAgIG1lcmdlZEF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4ge2F0dHJpYnV0ZXM6IHJlZ3VsYXJBdHRyaWJ1dGVzLCBhdHRhY2htZW50czogbWVyZ2VkQXR0YWNobWVudHN9XG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGF0dGFjaG1lbnQgcGF5bG9hZHMgb24gYSBtb2RlbCBhZnRlciB2YWxpZGF0aW5nIHBlcm1pdHMgYW5kIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgcmVjZWl2aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gQXR0YWNobWVudHMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyAtIEF0dHJpYnV0ZS9hdHRhY2htZW50IG5hbWVzIHBlcm1pdHRlZCBieSB0aGUgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBhdHRhY2htZW50cywgcGVybWl0dGVkQXR0cmlidXRlTmFtZXMpIHtcbiAgICBpZiAoIWF0dGFjaG1lbnRzKSByZXR1cm5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICBjb25zdCBwZXJtaXRTZXQgPSBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbC5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBtb2RlbENsYXNzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzID0gW11cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGludmFsaWRBdHRhY2htZW50cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgaWYgKCFwZXJtaXRTZXQuaGFzKGF0dGFjaG1lbnROYW1lKSkge1xuICAgICAgICBub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbnNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICAgIGludmFsaWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5xdWV1ZUF0dGFjaCh2YWx1ZSlcbiAgICB9XG5cbiAgICBpZiAobm90UGVybWl0dGVkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgRnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lcyBub3QgcGVybWl0dGVkIGJ5IHBlcm1pdHRlZFBhcmFtcygpOiAke25vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gICAgfVxuICAgIGlmIChpbnZhbGlkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgSW52YWxpZCBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IG5hbWVzOiAke2ludmFsaWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgb24gYSBtb2RlbCB2aWEgdGhlIHRyYW5zbGF0aW9ucyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSB2YWx1ZSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29udGV4dD8uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGxvY2FsZSA9IGNvbmZpZ3VyYXRpb24gPyBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpIDogXCJlblwiXG4gICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRyYW5zbGF0aW9uXG5cbiAgICBpZiAobW9kZWwuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChcInRyYW5zbGF0aW9uc1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgIHRyYW5zbGF0aW9uID0gbG9hZGVkLmZpbmQoKHQpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodCkubG9jYWxlKCkgPT09IGxvY2FsZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXRyYW5zbGF0aW9uKSB7XG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0ge31cblxuICAgIGFzc2lnbm1lbnRzW25hbWVdID0gdmFsdWVcbiAgICB0cmFuc2xhdGlvbi5hc3NpZ24oYXNzaWdubWVudHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KG1vZGVsKSB7XG4gICAgYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlRGVzdHJveShtb2RlbClcbiAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJEZXN0cm95KG1vZGVsKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgdG8gc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9IFthY3Rpb25dIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNlcmlhbGl6ZWQgbW9kZWwgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZShtb2RlbCwgYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuc2VyaWFsaXplRnJvbnRlbmRNb2RlbChtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb21tb24gbWV0YWRhdGEgZm9yIG9uZSBuZXN0ZWQtYXR0cmlidXRlcyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIHJlY2VpdmluZyBuZXN0ZWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IGFyZ3MucmF3RW50cmllcyAtIFJhdyBuZXN0ZWQgZW50cmllcyBmcm9tIHRoZSByZXF1ZXN0IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MuY2hpbGRQZXJtaXQgLSBQYXJzZWQgY2hpbGQgcGVybWl0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciBjaGlsZCByZXNvdXJjZSBsb29rdXAuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0eTogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGNoaWxkUHJpbWFyeUtleTogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbiwgY2hpbGRSZXNvdXJjZTogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSwgY2hpbGRSZXNvdXJjZUNvbmZpZzogRnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogc3RyaW5nW10sIGRlc3Ryb3lQZXJtaXR0ZWQ6IGJvb2xlYW4sIGVudHJpZXM6IEFycmF5PEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5PiwgcmVsYXRpb25zaGlwOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQsIHRhcmdldE1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19IE5lc3RlZCByZWxhdGlvbnNoaXAgY29udGV4dC5cbiAgICovXG4gIF9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtwYXJlbnQsIHJlbGF0aW9uc2hpcE5hbWUsIHJhd0VudHJpZXMsIGNoaWxkUGVybWl0LCBjb250cm9sbGVyfSkge1xuICAgIGlmICghY29udHJvbGxlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nIHJlcXVpcmUgYSBjb250cm9sbGVyIGluc3RhbmNlLmApXG4gICAgfVxuXG4gICAgY29uc3QgcGFyZW50TW9kZWxDbGFzcyA9IHBhcmVudC5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBtb2RlbEFjY2VwdGFuY2UgPSBwYXJlbnRNb2RlbENsYXNzLmFjY2VwdGVkTmVzdGVkQXR0cmlidXRlc0ZvcihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFtb2RlbEFjY2VwdGFuY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IGFjY2VwdCBuZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBEZWNsYXJlIGl0IHZpYSAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nKS5gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHBhcmVudE1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVHlwZSA9IHJlbGF0aW9uc2hpcC5nZXRUeXBlKClcbiAgICBjb25zdCByYXdOb3JtYWxpemVkRW50cmllcyA9IHRoaXMuX25lc3RlZFJlbGF0aW9uc2hpcEVudHJpZXMoe3Jhd0VudHJpZXMsIHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFR5cGV9KVxuICAgIGNvbnN0IGRlc3Ryb3lQZXJtaXR0ZWQgPSBjaGlsZFBlcm1pdC5hdHRyaWJ1dGVzLmluY2x1ZGVzKFwiX2Rlc3Ryb3lcIilcblxuICAgIGlmIChkZXN0cm95UGVybWl0dGVkICYmICFtb2RlbEFjY2VwdGFuY2UuYWxsb3dEZXN0cm95KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIHBlcm1pdHMgX2Rlc3Ryb3kgb24gbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCB0aGUgbW9kZWwgJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IGFsbG93IGRlc3Ryb3kgZm9yIHRoYXQgcmVsYXRpb25zaGlwLiBTZXQge2FsbG93RGVzdHJveTogdHJ1ZX0gb24gJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9LmFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKCcke3JlbGF0aW9uc2hpcE5hbWV9JywgLi4uKS5gKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIG1vZGVsQWNjZXB0YW5jZS5saW1pdCA9PT0gXCJudW1iZXJcIiAmJiByYXdOb3JtYWxpemVkRW50cmllcy5sZW5ndGggPiBtb2RlbEFjY2VwdGFuY2UubGltaXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGV4Y2VlZHMgbW9kZWwtZGVjbGFyZWQgbGltaXQgb2YgJHttb2RlbEFjY2VwdGFuY2UubGltaXR9LmApXG4gICAgfVxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlICE9PSBcImhhc01hbnlcIiAmJiByYXdOb3JtYWxpemVkRW50cmllcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBhY2NlcHRzIG9uZSBlbnRyeSBmb3IgJHtyZWxhdGlvbnNoaXBUeXBlfSByZWxhdGlvbnNoaXBzLmApXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgcmVzb2x2ZWQgZm9yIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScgb24gJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9LmApXG4gICAgfVxuXG4gICAgY29uc3QgY2hpbGRSZXNvdXJjZUNvbmZpZyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3ModGFyZ2V0TW9kZWxDbGFzcylcblxuICAgIGlmICghY2hpbGRSZXNvdXJjZUNvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RlcmVkIGZvciBjaGlsZCBtb2RlbCAnJHt0YXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfScgdW5kZXIgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9Jy5gKVxuICAgIH1cblxuICAgIGNvbnN0IENoaWxkUmVzb3VyY2UgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yKGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDbGFzcylcbiAgICBjb25zdCBjaGlsZFJlc291cmNlID0gbmV3IENoaWxkUmVzb3VyY2Uoe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCB8fCB7fSxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgbW9kZWxOYW1lOiBjaGlsZFJlc291cmNlQ29uZmlnLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogY29udHJvbGxlci5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfSlcbiAgICBjb25zdCBjaGlsZFByaW1hcnlLZXkgPSBjaGlsZFJlc291cmNlLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiX2Rlc3Ryb3lcIilcbiAgICBjb25zdCBlbnRyaWVzID0gcmF3Tm9ybWFsaXplZEVudHJpZXNcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGNoaWxkUHJpbWFyeUtleSwgZW50cnksIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSlcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgcmV0dXJuICFtb2RlbEFjY2VwdGFuY2UucmVqZWN0SWYoaXNQbGFpbk9iamVjdChlbnRyeS5hdHRyaWJ1dGVzKSA/IGVudHJ5LmF0dHJpYnV0ZXMgOiB7fSlcbiAgICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0eTogY29udHJvbGxlci5jdXJyZW50QWJpbGl0eSgpIHx8IHRoaXMuYWJpbGl0eSxcbiAgICAgIGNoaWxkUHJpbWFyeUtleSxcbiAgICAgIGNoaWxkUmVzb3VyY2UsXG4gICAgICBjaGlsZFJlc291cmNlQ29uZmlnLFxuICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICBkZXN0cm95UGVybWl0dGVkLFxuICAgICAgZW50cmllcyxcbiAgICAgIHJlbGF0aW9uc2hpcCxcbiAgICAgIHRhcmdldE1vZGVsQ2xhc3NcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBuZXN0ZWQgZW50cmllcyBmb3IgY29sbGVjdGlvbiBhbmQgc2luZ3VsYXIgcmVsYXRpb25zaGlwcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOZXN0ZWQgZW50cmllcyBpbnB1dHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwVHlwZSAtIFJlbGF0aW9uc2hpcCB0eXBlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeSBvYmplY3RzLlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcEVudHJpZXMoe3Jhd0VudHJpZXMsIHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFR5cGV9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcnJheSBmb3IgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCBnb3Q6ICR7dHlwZW9mIHJhd0VudHJpZXN9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJhd0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyaWVzIG11c3QgYmUgb2JqZWN0cy5gKVxuXG4gICAgICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKGVudHJ5KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAocmF3RW50cmllcyA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyYXdFbnRyaWVzKSkge1xuICAgICAgcmV0dXJuIHJhd0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyaWVzIG11c3QgYmUgb2JqZWN0cy5gKVxuXG4gICAgICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKGVudHJ5KVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHJhd0VudHJpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCBmb3IgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCBnb3Q6ICR7dHlwZW9mIHJhd0VudHJpZXN9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICByZXR1cm4gWy8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChyYXdFbnRyaWVzKV1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXN0ZWQgZW50cnkgZnJvbSBlaXRoZXIgaW50ZXJuYWwgdHJhbnNwb3J0IHNoYXBlXG4gICAqIChge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzLCBuZXN0ZWRBdHRyaWJ1dGVzfWApIG9yIGRpcmVjdCBSYWlscy1zdHlsZVxuICAgKiBmaWVsZHMgKGB7bmFtZSwgZmlsZSwgY29tbWVudHNBdHRyaWJ1dGVzfWApLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5vcm1hbGl6YXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdCBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MuY2hpbGRQcmltYXJ5S2V5IC0gUmVzb2x2ZWQgY2hpbGQgcmVzb3VyY2UgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9IGFyZ3MuZW50cnkgLSBSYXcgbmVzdGVkIGVudHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkuXG4gICAqL1xuICBfbm9ybWFsaXplTmVzdGVkUmVsYXRpb25zaGlwRW50cnkoe2NoaWxkUGVybWl0LCBjaGlsZFByaW1hcnlLZXksIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIikge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZFByaW1hcnlLZXkpKSB7XG4gICAgICAgICAgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhjaGlsZFByaW1hcnlLZXksIHZhbHVlKVxuICAgICAgICAgIG5vcm1hbGl6ZWQuaWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAqLyAodmFsdWUpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGlkIG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLmApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbm9ybWFsaXplZC5pZCA9IHZhbHVlXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IF9kZXN0cm95IG11c3QgYmUgYSBib29sZWFuLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLl9kZXN0cm95ID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0YWNobWVudHNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRhY2htZW50cyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dGFjaG1lbnRzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwibmVzdGVkQXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IG5lc3RlZEF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihuZXN0ZWRBdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbmVzdGVkIGF0dHJpYnV0ZXMga2V5OiAke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgICAgaWYgKCFjaGlsZFBlcm1pdC5uZXN0ZWRbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgdW5kZXIgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBJbmNsdWRlIHske2F0dHJpYnV0ZU5hbWV9OiBbLi4uXX0gaW4gdGhhdCBuZXN0ZWQgcGVybWl0LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1thdHRyaWJ1dGVOYW1lXSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBiZWxvbmdzLXRvIG5lc3RlZCBhdHRyaWJ1dGVzIGJlZm9yZSB0aGUgcGFyZW50IHNhdmUgc28gdGhlIHBhcmVudCBGSyBjYW4gYmUgc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChjb250ZXh0LnJlbGF0aW9uc2hpcCwgcGFyZW50LmdldE1vZGVsQ2xhc3MoKSlcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG5cbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICAgIGNoaWxkUHJpbWFyeUtleTogY29udGV4dC5jaGlsZFByaW1hcnlLZXksXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuZGVzdHJveShleGlzdGluZylcbiAgICAgICAgICBwYXJlbnQuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIG51bGwpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcbiAgICAgICAgY29uc3QgY2hpbGQgPSBpZCAhPSB1bmRlZmluZWRcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgICAgICAgY2hpbGRQcmltYXJ5S2V5OiBjb250ZXh0LmNoaWxkUHJpbWFyeUtleSxcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgICA6IG5ldyBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogY29udGV4dC5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgICAgICBlbnRyeVxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcyB8fCB7fSwgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIGF3YWl0IGNoaWxkLnNhdmUoKVxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG5cbiAgICAgICAgcGFyZW50LnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShjaGlsZC5pZCgpLCBgTmVzdGVkIGJlbG9uZ3MtdG8gd3JpdGUgZm9yICR7Y2hpbGQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCkpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBgbmVzdGVkQXR0cmlidXRlc2AgcGF5bG9hZCB0byBhIGZyZXNobHktc2F2ZWQgcGFyZW50IG1vZGVsLFxuICAgKiBjYXNjYWRpbmcgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IHdyaXRlcyBhY3Jvc3MgdGhlIGRlY2xhcmVkIHJlbGF0aW9uc2hpcHMuXG4gICAqXG4gICAqIEVhY2ggY2hpbGQgaXMgYXV0aG9yaXplZCBhZ2FpbnN0IGl0cyBvd24gcmVzb3VyY2UncyBhYmlsaXRpZXMgKG5ldmVyIHRoZVxuICAgKiBwYXJlbnQncykuIERlc3Ryb3lzIHJ1biBiZWZvcmUgdXBkYXRlcywgdXBkYXRlcyBiZWZvcmUgY3JlYXRlcywgdG8gYXZvaWRcbiAgICogdW5pcXVlLWNvbnN0cmFpbnQgY29uZmxpY3RzIHdoZW4gcmVwbGFjaW5nIGEgY2hpbGQgYXQgdGhlIHNhbWUgbmF0dXJhbCBrZXkuXG4gICAqXG4gICAqIEF0dHJpYnV0ZSBmaWx0ZXJpbmcgZm9yIG5lc3RlZCBjaGlsZHJlbiB1c2VzIHRoZSBwYXJlbnQgcmVzb3VyY2Unc1xuICAgKiBwZXJtaXQgc3BlYyBmb3IgdGhhdCByZWxhdGlvbnNoaXAg4oCUIGFwaV9tYWtlci1zdHlsZS4gUG9saWN5IG9wdGlvbnNcbiAgICogKGFsbG93RGVzdHJveSwgbGltaXQsIHJlamVjdElmKSBjb21lIGZyb20gdGhlIE1PREVMJ3NcbiAgICogYGFjY2VwdGVkTmVzdGVkQXR0cmlidXRlc0ZvcihuYW1lKWAgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBuZXN0ZWRBdHRyaWJ1dGVzIC0gTmVzdGVkLWF0dHJpYnV0ZSBwYXlsb2FkIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBjb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgcmVzb3VyY2UgcmVzb2x1dGlvbiBhbmQgYXV0aG9yaXphdGlvbi5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IG51bGx9IFtwYXJlbnRQZXJtaXRdIC0gUGFyc2VkIHBhcmVudCBwZXJtaXQgc3BlYy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKHBhcmVudCwgbmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgcGFyZW50UGVybWl0ID0gbnVsbCkge1xuICAgIGNvbnN0IHJlc29sdmVkUGFyZW50ID0gcGFyZW50UGVybWl0XG4gICAgICB8fCBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczoge319KSlcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgY2hpbGRQZXJtaXQgPSByZXNvbHZlZFBhcmVudC5uZXN0ZWRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFjaGlsZFBlcm1pdCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgYnkgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LnBlcm1pdHRlZFBhcmFtcygpLiBJbmNsdWRlIHske3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlczogWy4uLl19IGluIHRoZSByZXR1cm5lZCBwZXJtaXQuYClcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGV4dCA9IHRoaXMuX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe1xuICAgICAgICBjaGlsZFBlcm1pdCxcbiAgICAgICAgY29udHJvbGxlcixcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByYXdFbnRyaWVzOiBuZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lXG4gICAgICB9KVxuXG4gICAgICBpZiAoY29udGV4dC5yZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJlbnRMaW5rQXR0cmlidXRlcyA9IHRoaXMuX3BhcmVudExpbmtBdHRyaWJ1dGVzRm9yTmVzdGVkQ2hpbGQoe1xuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJlbGF0aW9uc2hpcDogY29udGV4dC5yZWxhdGlvbnNoaXAsXG4gICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgfSlcblxuICAgICAgY29uc3QgZGVzdHJveUVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgdXBkYXRlRW50cmllcyA9IFtdXG4gICAgICBjb25zdCBjcmVhdGVFbnRyaWVzID0gW11cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Py5fZGVzdHJveSkge1xuICAgICAgICAgIGlmICghY29udGV4dC5kZXN0cm95UGVybWl0dGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSByZXF1ZXN0ZWQgX2Rlc3Ryb3kgYnV0IFwiX2Rlc3Ryb3lcIiBpcyBub3QgaW4gdGhlIHBlcm1pdCBmb3IgdGhpcyByZWxhdGlvbnNoaXAuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFlbnRyeS5pZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBkZXN0cm95RW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9IGVsc2UgaWYgKGVudHJ5Py5pZCkge1xuICAgICAgICAgIHVwZGF0ZUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjcmVhdGVFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBkZXN0cm95RW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fZmluZFNjb3BlZENoaWxkKHtcbiAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIGlkLFxuICAgICAgICAgIHBhcmVudCxcbiAgICAgICAgICBwYXJlbnRMaW5rQXR0cmlidXRlcyxcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHVwZGF0ZUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSB1cGRhdGUgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgY2hpbGRQcmltYXJ5S2V5OiBjb250ZXh0LmNoaWxkUHJpbWFyeUtleSxcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBwYXJlbnQsXG4gICAgICAgICAgcGFyZW50TGlua0F0dHJpYnV0ZXMsXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQ6IGV4aXN0aW5nLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgZXhpc3Rpbmcuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjcmVhdGVFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgY2hpbGQuYXNzaWduKHBhcmVudExpbmtBdHRyaWJ1dGVzKVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBvbmUgbmVzdGVkIGVudHJ5J3MgYXR0cmlidXRlcyBhbmQgYXR0YWNobWVudHMgdG8gYSBjaGlsZCBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBc3NpZ25tZW50IGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5jaGlsZCAtIENoaWxkIG1vZGVsIHJlY2VpdmluZyBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzIC0gUGVybWl0dGVkIGNoaWxkIGF0dHJpYnV0ZSBhbmQgYXR0YWNobWVudCBuYW1lcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZW50cnkgLSBOZXN0ZWQgZW50cnkgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtjaGlsZCwgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsIGVudHJ5fSkge1xuICAgIGlmIChlbnRyeS5hdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChlbnRyeS5hdHRyaWJ1dGVzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbmVzdGVkIGVudHJ5IGF0dHJpYnV0ZXMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuXG4gICAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoY2hpbGQsIGNoaWxkLmdldE1vZGVsQ2xhc3MoKSwgZW50cnkuYXR0cmlidXRlcywgdGhpcywgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMpXG4gICAgICBhd2FpdCB0aGlzLl9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMoY2hpbGQsIGZpbHRlcmVkKVxuICAgIH1cblxuICAgIGlmIChlbnRyeS5hdHRhY2htZW50cyAhPT0gdW5kZWZpbmVkICYmICFpc1BsYWluT2JqZWN0KGVudHJ5LmF0dGFjaG1lbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbmVzdGVkIGVudHJ5IGF0dGFjaG1lbnRzIHRvIGJlIGFuIG9iamVjdC5cIilcbiAgICB9XG5cbiAgICB0aGlzLl9hc3NpZ25BdHRhY2htZW50cyhjaGlsZCwgZW50cnkuYXR0YWNobWVudHMgPz8gbnVsbCwgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBmb3JlaWduLWtleSBjb2x1bW4vbmFtZSB0byB0aGUgdGFyZ2V0IG1vZGVsJ3MgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgRksuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEZvcmVpZ24ta2V5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldIHx8IGZvcmVpZ25LZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBGSyBhdHRyaWJ1dGVzIHRoYXQgYmluZCBhIG5lc3RlZCBjaGlsZCB0byBpdHMgcGFyZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhcmVudC1saW5rIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gQXR0cmlidXRlcyB0aGF0IHNjb3BlIHRoZSBjaGlsZCB0byB0aGUgcGFyZW50LlxuICAgKi9cbiAgX3BhcmVudExpbmtBdHRyaWJ1dGVzRm9yTmVzdGVkQ2hpbGQoe3BhcmVudCwgcmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSB0aGlzLl9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge1tmb3JlaWduS2V5XTogc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocGFyZW50LmlkKCksIGBOZXN0ZWQgY2hpbGQgd3JpdGUgZm9yICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICBjb25zdCB0eXBlQXR0cmlidXRlID0gdGhpcy5fcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBhdHRyaWJ1dGVzW3R5cGVBdHRyaWJ1dGVdID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBwb2x5bW9ycGhpYyB0eXBlIGNvbHVtbi9uYW1lIHRvIGEgY2hpbGQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgdHlwZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBvbHltb3JwaGljIHR5cGUgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpY1R5cGVDb2x1bW4oKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3R5cGVDb2x1bW5dIHx8IHR5cGVDb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBhdXRob3JpemVkIG5lc3RlZCByZWNvcmQgYnkgaWQgd2l0aG91dCBwYXJlbnQgc2NvcGluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLmNoaWxkUHJpbWFyeUtleSAtIFJlc29sdmVkIGNoaWxkIHJlc291cmNlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gQ2hpbGQgaWQgZnJvbSB0aGUgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEF1dGhvcml6ZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZE5lc3RlZFJlY29yZCh7YWJpbGl0eSwgYWN0aW9uLCBjaGlsZFByaW1hcnlLZXksIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhjaGlsZFByaW1hcnlLZXksIGlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90ICR7YWN0aW9ufSBuZXN0ZWQgJHtyZWxhdGlvbnNoaXBOYW1lfVtpZD0ke2lkfV06IHJlY29yZCBub3QgZm91bmQgb3Igbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG5cbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWJpbGl0eSBhY3Rpb24gZm9yIGEgY2hpbGQgcmVzb3VyY2UgdXNpbmcgdGhlIGNoaWxkJ3Mgb3duXG4gICAqIGBhYmlsaXRpZXNgIG1hcHBpbmcg4oCUIG5ldmVyIHRoZSBwYXJlbnQgY29udHJvbGxlcidzLiBUaGlzIHByZXNlcnZlc1xuICAgKiBjdXN0b20gbWFwcGluZ3MgbGlrZSBge3VwZGF0ZTogXCJtYW5hZ2VcIn1gIGFuZCBjYXRjaGVzIHVubWFwcGVkIGFjdGlvbnNcbiAgICogaW5zdGVhZCBvZiBzaWxlbnRseSBkZWZhdWx0aW5nIHRvIHRoZSByYXcgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYmlsaXR5IGFjdGlvbiBmb3IgdGhlIGNoaWxkIHJlc291cmNlLlxuICAgKi9cbiAgX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uPy5hYmlsaXRpZXNcblxuICAgIGlmICghYWJpbGl0aWVzIHx8IHR5cGVvZiBhYmlsaXRpZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhbiAnYWJpbGl0aWVzJyBvYmplY3QgdG8gYXV0aG9yaXplIG5lc3RlZCAke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAoYWJpbGl0aWVzKVthY3Rpb25dXG5cbiAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhYmlsaXRpZXMuJHthY3Rpb259LmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBleGlzdGluZyBjaGlsZCBmb3IgYSBuZXN0ZWQgdXBkYXRlL2Rlc3Ryb3ksIHNjb3BlZCB0byB0aGVcbiAgICogY2hpbGQncyBvd24gbW9kZWwgY2xhc3MsIHRoZSBwYXJlbnQncyBmb3JlaWduIGtleSwgQU5EIHRoZSBjaGlsZFxuICAgKiByZXNvdXJjZSdzIGFiaWxpdHkgbWFwcGluZyBmb3IgdGhlIHJlcXVlc3RlZCBhY3Rpb24uIFRocm93cyB3aGVuIHRoZVxuICAgKiBjaGlsZCBkb2VzIG5vdCBleGlzdCwgZG9lcyBub3QgYmVsb25nIHRvIHRoZSBjdXJyZW50IHBhcmVudCwgb3IgaXNcbiAgICogbm90IGF1dGhvcml6ZWQg4oCUIGFsbCBvZiB3aGljaCBtdXN0IHJvbGwgdGhlIHRyYW5zYWN0aW9uIGJhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLmNoaWxkUHJpbWFyeUtleSAtIFJlc29sdmVkIGNoaWxkIHJlc291cmNlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gQ2hpbGQgaWQgZnJvbSB0aGUgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gYXJncy5wYXJlbnRMaW5rQXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdGhhdCBzY29wZSB0aGUgY2hpbGQgdG8gdGhlIHBhcmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIChmb3IgZXJyb3IgbWVzc2FnZXMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBBdXRob3JpemVkLCBwYXJlbnQtbGlua2VkIGNoaWxkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgX2ZpbmRTY29wZWRDaGlsZCh7YWJpbGl0eSwgYWN0aW9uLCBjaGlsZFByaW1hcnlLZXksIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcGFyZW50LCBwYXJlbnRMaW5rQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBpZGVudGl0eUNvbmRpdGlvbnMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKGNoaWxkUHJpbWFyeUtleSwgaWQpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCBwYXJlbnRWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGFyZW50TGlua0F0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGlkZW50aXR5Q29uZGl0aW9ucywgYXR0cmlidXRlTmFtZSkgJiYgaWRlbnRpdHlDb25kaXRpb25zW2F0dHJpYnV0ZU5hbWVdICE9PSBwYXJlbnRWYWx1ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiBpZGVudGl0eSBmaWVsZCAnJHthdHRyaWJ1dGVOYW1lfScgZG9lcyBub3QgbWF0Y2ggcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0uYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBsb29rdXAgPSB7Li4uaWRlbnRpdHlDb25kaXRpb25zLCAuLi5wYXJlbnRMaW5rQXR0cmlidXRlc31cbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShsb29rdXApXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kLCBkb2VzIG5vdCBiZWxvbmcgdG8gcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0sIG9yIGlzIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgYW4gYWxyZWFkeS1zYXZlZCBuZXN0ZWQgY2hpbGQgaXMgYXV0aG9yaXplZCB1bmRlciB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBvd24gYGNyZWF0ZWAgYWJpbGl0eS4gUm9sbHMgYmFjayB2aWEgdGhyb3duIGVycm9yIHdoZW4gbm90XG4gICAqIGF1dGhvcml6ZWQgc28gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGRlc3Ryb3lzIHRoZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCBpbnN0YW5jZSBqdXN0IGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gYXJncy5jaGlsZFByaW1hcnlLZXkgLSBSZXNvbHZlZCBjaGlsZCByZXNvdXJjZSBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIChmb3IgZXJyb3IgbWVzc2FnZXMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2F1dGhvcml6ZUNyZWF0ZWRDaGlsZCh7YWJpbGl0eSwgY2hpbGQsIGNoaWxkUHJpbWFyeUtleSwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm5cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSB0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBcImNyZWF0ZVwiKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKGNoaWxkUHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGNoaWxkLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gICAgY29uc3QgYXV0aG9yaXplZENoaWxkID0gYXdhaXQgdGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbiwgYWJpbGl0eSlcbiAgICAgIC5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhjaGlsZFByaW1hcnlLZXksIGlkZW50aXR5KSlcblxuICAgIGlmICghYXV0aG9yaXplZENoaWxkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjcmVhdGUgb24gJHtyZWxhdGlvbnNoaXBOYW1lfVske3RhcmdldE1vZGVsQ2xhc3MubmFtZX1dIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIG5lc3RlZCB3cml0ZXMsIHByZWxvYWQgZXZlcnkgcmVsYXRpb25zaGlwIGRlY2xhcmVkIGluIHRoZVxuICAgKiBwYXJlbnQncyBwZXJtaXQgc28gdGhlIHBvc3Qtc2F2ZSBzZXJpYWxpemUgc3RlcCBlbWl0cyB0aGVtIGFuZCB0aGVcbiAgICogY2xpZW50IGNhbiByZWNvbmNpbGUgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIFNhdmVkIHBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gcGVybWl0IC0gUGFyc2VkIHBhcmVudCBwZXJtaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3ByZWxvYWROZXN0ZWRXcml0YWJsZVJlbGF0aW9uc2hpcHMobW9kZWwsIHBlcm1pdCkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWVzID0gT2JqZWN0LmtleXMocGVybWl0Lm5lc3RlZClcblxuICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlbGF0aW9uc2hpcE5hbWVzKSB7XG4gICAgICBhd2FpdCBtb2RlbC5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUGFyc2VzIHRoZSBSYWlscy9hcGlfbWFrZXItc3R5bGUgZmxhdCBwZXJtaXQgc3BlYyByZXR1cm5lZCBmcm9tXG4gKiBgcGVybWl0dGVkUGFyYW1zKGFyZylgIGludG8gYSBzdHJ1Y3R1cmVkIHNoYXBlIHVzZWQgaW50ZXJuYWxseSBieSB0aGVcbiAqIHdyaXRlIHBpcGVsaW5lLiBTdHJpbmdzIGJlY29tZSBhdHRyaWJ1dGUgcGVybWl0czsgb2JqZWN0cyB3aG9zZSBrZXlzXG4gKiBlbmQgaW4gYEF0dHJpYnV0ZXNgIGJlY29tZSBuZXN0ZWQgcGVybWl0cyAodGhlIGtleSBwcmVmaXggbmFtZXMgdGhlXG4gKiByZWxhdGlvbnNoaXApLlxuICpcbiAqICAgcGFyc2VQZXJtaXR0ZWRQYXJhbXMoW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIixcbiAqICAgICB7dGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAqICAgXSlcbiAqICAgLy8g4oaSIHtcbiAqICAgLy8gICBhdHRyaWJ1dGVzOiBbXCJmaXJzdE5hbWVcIiwgXCJsYXN0TmFtZVwiXSxcbiAqICAgLy8gICBuZXN0ZWQ6IHtcbiAqICAgLy8gICAgIHRhc2tzOiB7YXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl0sIG5lc3RlZDoge319XG4gKiAgIC8vICAgfVxuICogICAvLyB9XG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCB1bmRlZmluZWR9IHBlcm1pdFNwZWMgLSBGbGF0IHBlcm1pdCBzcGVjLlxuICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCB7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59fSAtIFBhcnNlZCBzdHJ1Y3R1cmUuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUGVybWl0dGVkUGFyYW1zKHBlcm1pdFNwZWMpIHtcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICBjb25zdCBuZXN0ZWQgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShwZXJtaXRTcGVjKSkgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBwZXJtaXRTcGVjKSB7XG4gICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgYXR0cmlidXRlcy5wdXNoKGVudHJ5KVxuICAgIH0gZWxzZSBpZiAoZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IG5lc3RlZCByZWxhdGlvbnNoaXAga2V5cyBtdXN0IGVuZCBpbiBcIkF0dHJpYnV0ZXNcIiAoZ290IFwiJHtrZXl9XCIpLiBVc2UgXCIke2tleX1BdHRyaWJ1dGVzXCIgaW5zdGVhZC5gKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBrZXkuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcblxuICAgICAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBlbXB0eSByZWxhdGlvbnNoaXAgbmFtZSBpbiBrZXkgXCIke2tleX1cIi5gKVxuICAgICAgICB9XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5IGZvciBcIiR7a2V5fVwiOiBleHBlY3RlZCBhcnJheSBwZXJtaXQgc3BlYywgZ290ICR7dHlwZW9mIHZhbHVlfS5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModmFsdWUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IGV4cGVjdGVkIHN0cmluZyBvciBuZXN0ZWQtYXR0cmlidXRlcyBvYmplY3QsIGdvdCAke3R5cGVvZiBlbnRyeX0uYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2F0dHJpYnV0ZXMsIG5lc3RlZH1cbn1cblxuLyoqXG4gKiBMb2NhdGVzIHdoaWNoIHByb3RvdHlwZSBvd25zIGEgbWV0aG9kIGltcGxlbWVudGF0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGluc3RhbmNlIC0gSW5zdGFuY2UgcmVjZWl2aW5nIHRoZSBtZXRob2QuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICogQHJldHVybnMge29iamVjdCB8IG51bGx9IC0gUHJvdG90eXBlIHRoYXQgb3ducyB0aGUgbWV0aG9kLlxuICovXG5mdW5jdGlvbiBwcm90b3R5cGVPd25lckZvck1ldGhvZChpbnN0YW5jZSwgbWV0aG9kTmFtZSkge1xuICBsZXQgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGluc3RhbmNlKVxuXG4gIHdoaWxlIChwcm90b3R5cGUpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHByb3RvdHlwZSwgbWV0aG9kTmFtZSkpIHJldHVybiBwcm90b3R5cGVcblxuICAgIHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90b3R5cGUpXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgZmlsdGVyIHdyaXRhYmxlIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFJlc291cmNlTW9kZWxDbGFzc1xuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVjZWl2ZXIgLSBNb2RlbCBpbnN0YW5jZSBvciBwcm90b3R5cGUuXG4gKiBAcGFyYW0ge1dyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc30gcmVjZWl2ZXJDbGFzcyAtIFN0YXRpYyBoZWxwZXIgb3duZXIgZm9yIHRoZSByZWNlaXZlci5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxSZXNvdXJjZU1vZGVsQ2xhc3MsIFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9IFtyZXNvdXJjZV0gLSBSZXNvdXJjZSBpbnN0YW5jZSBmb3IgdmlydHVhbC1zZXR0ZXIgZGV0ZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IG51bGx9IFtwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lc10gLSBPcHRpb25hbCBleHBsaWNpdCBwZXJtaXQgbGlzdC4gYG51bGxgIGZhbGxzIGJhY2sgdG8gc2V0dGVyLWV4aXN0ZW5jZSBjaGVja3Mgb25seS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV3JpdGFibGUgYXR0cmlidXRlcyBvbmx5LlxuICovXG5mdW5jdGlvbiBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKFxuICByZWNlaXZlcixcbiAgcmVjZWl2ZXJDbGFzcyxcbiAgYXR0cmlidXRlcyxcbiAgcmVzb3VyY2UgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8UmVzb3VyY2VNb2RlbENsYXNzLCBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsfSAqLyAobnVsbCksXG4gIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzID0gbnVsbFxuKSB7XG4gIC8vIEZyb250ZW5kLW1vZGVsIHdyaXRlcyBzaG91bGQgZmFpbCBmYXN0IHdoZW4gY2FsbGVycyBzdWJtaXQgcmVhZC1vbmx5IG9yIHVua25vd24gYXR0cnMuXG4gIC8vIFNpbGVudCBkcm9wcyBoaWRlIGNvbnRyYWN0IG1pc3Rha2VzIGluIGdlbmVyYXRlZCBtb2RlbHMgYW5kIGFwcC1zaWRlIHdyYXBwZXIgY29kZS5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHdyaXRhYmxlQXR0cmlidXRlcyA9IHt9XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3Qgbm90UGVybWl0dGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgY29uc3QgcGVybWl0U2V0ID0gQXJyYXkuaXNBcnJheShwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgPyBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSA6IG51bGxcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgbGV0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gW11cblxuICBpZiAocmVzb3VyY2UpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHJlc291cmNlLmNvbnN0cnVjdG9yKVxuXG4gICAgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSBSZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW11cbiAgfVxuXG4gIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KHRyYW5zbGF0ZWRBdHRyaWJ1dGVzKVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgIGlmIChwZXJtaXRTZXQgJiYgIXBlcm1pdFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSByZWNlaXZlckNsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHx8IGF0dHJpYnV0ZU5hbWVcbiAgICBjb25zdCByZXF1ZXN0ZWRTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpfWBcbiAgICBjb25zdCBzZXR0ZXJOYW1lID0gcmVjZWl2ZXJDbGFzcy5maW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlKHJlY2VpdmVyLCByZXF1ZXN0ZWRTZXR0ZXJOYW1lKSB8fCByZXF1ZXN0ZWRTZXR0ZXJOYW1lXG4gICAgY29uc3QgcmVzb3VyY2VTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX1BdHRyaWJ1dGVgXG4gICAgY29uc3QgcmVzb3VyY2VTZXR0ZXIgPSByZXNvdXJjZT8ucmVzb3VyY2VNZXRob2QocmVzb3VyY2VTZXR0ZXJOYW1lKVxuXG4gICAgaWYgKHNldHRlck5hbWUgaW4gcmVjZWl2ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmIChyZXNvdXJjZVNldHRlcikge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBpbnZhbGlkQXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICB9XG5cbiAgaWYgKG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gIH1cblxuICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgd3JpdGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgcmV0dXJuIHdyaXRhYmxlQXR0cmlidXRlc1xufVxuIl19