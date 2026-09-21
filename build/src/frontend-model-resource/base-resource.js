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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sRUFBQyx5QkFBeUIsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQzdILE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7O0dBSUc7QUFFSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7Ozs7O0dBU0c7QUFFSDs7Ozs7Ozs7Ozs7O0dBWUc7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFDSCxNQUFNLFVBQVUsd0NBQXdDLENBQUMsYUFBYTtJQUNwRSxPQUFPLG1LQUFtSyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQTtBQUNyTixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQTBCLFNBQVEseUJBQXlCO0lBQzlFLDBEQUEwRDtJQUMxRCxNQUFN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QUNqQyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsNENBQTRDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtJQUNqSixDQUFDO0lBRUQsT0FBTyxrQkFBa0IsQ0FBQTtBQUMzQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7bW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlLCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBCYWNrZW5kIG9yIGZyb250ZW5kIG1vZGVsIGNsYXNzIGJvdW5kIHRvIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCIpLkF1dGhvcml6YXRpb25SZXNvdXJjZU1vZGVsQ2xhc3MgJiB7YXR0YWNobWVudERlZmluaXRpb25zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4sIHByaW1hcnlLZXk6ICgpID0+IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzXG4gKi9cblxuLyoqXG4gKiBCdWlsdC1pbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBhY3Rpb24uXG4gKiBAdHlwZWRlZiB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvblxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYW4gYXV0aG9yaXplZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF1dGhvcml6ZWRRdWVyeU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBbcnVsZVF1ZXJ5RmFjdG9yeV0gLSBRdWVyeSBmYWN0b3J5IHVzZWQgd2hlbiBhdXRob3JpemF0aW9uIG11c3QgdGFyZ2V0IGEgY2FwdHVyZWQgcmVjb3JkIHNuYXBzaG90LlxuICovXG5cbi8qKlxuICogRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBtZXRob2RzIHVzZWQgYnkgcmVzb3VyY2VzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdCAmIHtcbiAqICAgY3VycmVudEFiaWxpdHk6ICgpID0+IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uOiAoYXJnczoge3BhZ2luYXRpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24sIHF1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTZWFyY2g6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc2VhcmNoOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTb3J0OiAoYXJnczoge3F1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sIHNvcnQ6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9KSA9PiB2b2lkLFxuICogICBmcm9udGVuZE1vZGVsQWJpbGl0eUFjdGlvbjogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBzdHJpbmcsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24sIG9wdGlvbnM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdXRob3JpemVkUXVlcnlPcHRpb25zKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnk6IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbiwgb3B0aW9ucz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF1dGhvcml6ZWRRdWVyeU9wdGlvbnMpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEluZGV4UXVlcnk6IChvcHRpb25zPzogRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnMgJiB7cmVzb3VyY2U/OiBQaWNrPEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4sIFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydFwiPn0pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbFBhcmFtczogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMsXG4gKiAgIGZyb250ZW5kTW9kZWxQcmVsb2FkOiAoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbCxcbiAqICAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3M6IChtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGwsXG4gKiAgIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWw6IChtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgb2JqZWN0IHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+PlxuICogfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlclxuICovXG5cbi8qKlxuICogR2VuZXJpYyBmcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeSBwYXNzZWQgdG8gcmVzb3VyY2UgcXVlcnkgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBpbmRleCBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyB0eXBlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPXR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGNvbnRyb2xsZXIgLSBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGluc3RhbmNlLlxuICogQHByb3BlcnR5IHtURGF0YWJhc2VNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbiAob3IgcmF3IGlucHV0IHNoYXBlIGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3MgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gW1RNb2RlbENsYXNzPUZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3NdXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnc1xuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZSB3aGVuIHRoZSByZXNvdXJjZSBpcyB1c2VkIGRpcmVjdGx5IGZvciBhdXRob3JpemF0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyLWxlc3MgY29uc3RydWN0aW9uIChmb3IgZXhhbXBsZSB0aGUgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCk7IHRoZSBjb250cm9sbGVyIHBhdGggZGVyaXZlcyBpdCBmcm9tIHRoZSBjb250cm9sbGVyIGluc3RlYWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtjb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2xvY2Fsc10gLSBBYmlsaXR5IGxvY2Fscy5cbiAqIEBwcm9wZXJ0eSB7VE1vZGVsQ2xhc3N9IFttb2RlbENsYXNzXSAtIE9wdGlvbmFsIGJhY2tpbmcgbW9kZWwgY2xhc3Mgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW21vZGVsTmFtZV0gLSBPcHRpb25hbCBtb2RlbCBuYW1lIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gW3BhcmFtc10gLSBPcHRpb25hbCBwYXJhbXMgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IFtyZXNvdXJjZUNvbmZpZ3VyYXRpb25dIC0gT3B0aW9uYWwgbm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogSW50ZXJuYWwgY29uc3RydWN0b3IgY29udHJhY3QgdXNlZCB3aGVuIGEgcmVzb3VyY2UgaW5zdGFudGlhdGVzIGl0cyBzaGFyZWRcbiAqIGNvdW50ZXJwYXJ0IGFjcm9zcyB0aGUgZnJvbnRlbmQvYmFja2VuZCBtb2RlbCBib3VuZGFyeS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gVE1vZGVsQ2xhc3NcbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBURGF0YWJhc2VNb2RlbENsYXNzXG4gKiBAdHlwZWRlZiB7e25ldyAoYXJnczogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3M8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4gfCBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyk6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fX0gRnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvclxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBwYXNzZWQgdG8gdGhlIHJlc291cmNlIHN5bmMgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vc3luYy9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gRnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvblxuICovXG5cbi8qKlxuICogU3luYyBtdXRhdGlvbiBhdXRob3JpemF0aW9uIHJlc3VsdC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvblxuICogQHByb3BlcnR5IHtib29sZWFufSBhbGxvd2VkIC0gV2hldGhlciB0aGUgbXV0YXRpb24gbWF5IGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3JlYXNvbl0gLSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSB3aGVuIGRlbmllZC5cbiAqL1xuXG4vKipcbiAqIEFyZ3VtZW50cyBmb3IgdGhlIGFwcGx5U3luYyBmdWxsLWVzY2FwZS1oYXRjaCBob29rLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3NcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gZXhpc3RpbmdTeW5jIC0gRXhpc3Rpbmcgc3luYyByb3cgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAqL1xuXG4vKipcbiAqIEFwcGx5IHJlc3VsdCBwcm9kdWNlZCBieSByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY3JlYXRlZCAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGNyZWF0ZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWxldGVkXSAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGRlbGV0ZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gcmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAqL1xuXG4vKipcbiAqIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdHJhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3Qgb3duaW5nIHRoZSByZXNvdXJjZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gcmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cblxuLyoqXG4gKiBUcmFuc3BvcnQtc2FmZSB2YWx1ZSBhY2NlcHRlZCBpbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbiBwYXlsb2Fkcy5cbiAqIE5lc3RlZCBvYmplY3QvYXJyYXkgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0c1xuICogcmVjdXJzaXZlIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCBwYXlsb2FkIGNvbnRyYWN0LlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlXG4gKi9cblxuLyoqXG4gKiBBdHRyaWJ1dGUgcGF5bG9hZCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbnMuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZFxuICovXG5cbi8qKlxuICogVmlydHVhbCBzZXR0ZXIgbWV0aG9kIG9uIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7KGFyZzE6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBhcmcyOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWUpID0+ICh2b2lkIHwgUHJvbWlzZTx2b2lkPil9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVZpcnR1YWxTZXR0ZXJcbiAqL1xuXG4vKipcbiAqIFN0YXRpYyBoZWxwZXJzIHVzZWQgd2hlbiBjaGVja2luZyB3aGV0aGVyIGEgbW9kZWwtbGlrZSByZWNlaXZlciBhY2NlcHRzIGFuIGF0dHJpYnV0ZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc1xuICogQHByb3BlcnR5IHsoYXJnOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IHJlc29sdmVBdHRyaWJ1dGVOYW1lIC0gUmVzb2x2ZXMgYWxpYXNlcyB0byBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWVzLlxuICogQHByb3BlcnR5IHsoYXJnMTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhcmcyOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUgLSBMb2NhdGVzIGEgc2V0dGVyIG1ldGhvZCBvbiB0aGUgcmVjZWl2ZXIuXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIHBhc3NlZCB3aGlsZSBzYXZpbmcgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFthdHRhY2htZW50c10gLSBVcGxvYWRlZCBhdHRhY2htZW50IGF0dHJpYnV0ZXMuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsfSBbY29udHJvbGxlcl0gLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBtdXRhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFtuZXN0ZWRBdHRyaWJ1dGVzXSAtIE5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cblxuLyoqXG4gKiBOb3JtYWxpemVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgJiB7aWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgX2Rlc3Ryb3k/OiBib29sZWFuLCBhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCwgYXR0YWNobWVudHM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBuZXN0ZWRBdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH19IEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5XG4gKi9cblxuLyoqXG4gKiBOYXJyb3dzIGFuIHVuYm91bmQgcmVzb3VyY2UgcmVnaXN0cnkgZW50cnkgYXQgZnJhbWV3b3JrLW93bmVkIGNvbnN0cnVjdGlvblxuICogc2l0ZXMgd2hlcmUgdGhlIGJhY2tpbmcgZGF0YWJhc2UgbW9kZWwgaGFzIGFscmVhZHkgYmVlbiByZXNvbHZlZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IFJlc291cmNlQ2xhc3MgLSBVbmJvdW5kIHJlc291cmNlIGNsYXNzLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3I8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBSdW50aW1lIGNvbnN0cnVjdG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcihSZXNvdXJjZUNsYXNzKSB7XG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3I8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoUmVzb3VyY2VDbGFzcykpXG59XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgYmFja2VuZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFtUTW9kZWxDbGFzcz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gW1REYXRhYmFzZU1vZGVsQ2xhc3M9RXh0cmFjdDxUTW9kZWxDbGFzcywgdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pl1cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBleHRlbmRzIEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2Uge1xuICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBNb2RlbENsYXNzID0gdW5kZWZpbmVkXG5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGFiaWxpdGllcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGF0dGFjaG1lbnRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBjb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29sbGVjdGlvbkNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBwcmltYXJ5S2V5ID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTZXJ2ZXJDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc2VydmVyID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbiB8IGJvb2xlYW4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBzeW5jID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICBzdGF0aWMgU2hhcmVkUmVzb3VyY2UgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogRGVjbGFyYXRpdmUgd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0IChjYW1lbENhc2UgYXR0cmlidXRlIG5hbWVzKVxuICAgKiB1c2VkIGFzIHRoZSBkZWZhdWx0IHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlI3Blcm1pdHRlZFBhcmFtc30gYW5kXG4gICAqIGFzIHRoZSByb3V0ZWQgc3luYyByZXBsYXkgcGVybWl0LiBSZXNvbHZlZCB0aHJvdWdoIHRoZSBzaGFyZWQgcmVzb3VyY2VcbiAgICogbGlrZSB0aGUgb3RoZXIgc3RhdGljIHJlc291cmNlIGNvbmZpZzogYW4gdW5kZWNsYXJlZCBlbnZpcm9ubWVudCBsaXN0XG4gICAqIGZhbGxzIGJhY2sgdG8gdGhlIHNoYXJlZCByZXNvdXJjZSdzIGxpc3QsIHdoaWxlIGFuIGV4cGxpY2l0IGRlY2xhcmF0aW9uXG4gICAqIChpbmNsdWRpbmcgYG51bGxgKSB3aW5zLlxuICAgKiBAdHlwZSB7c3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgd3JpdGFibGVBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3M8VE1vZGVsQ2xhc3M+IHwgRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3M8VERhdGFiYXNlTW9kZWxDbGFzcz59IGFyZ3MgLSBSZXNvdXJjZSBhcmdzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIHN1cGVyKHtcbiAgICAgIGFiaWxpdHk6IFwiYWJpbGl0eVwiIGluIGFyZ3MgPyBhcmdzLmFiaWxpdHkgOiB1bmRlZmluZWQsXG4gICAgICBjb250ZXh0OiBcImNvbnRleHRcIiBpbiBhcmdzID8gYXJncy5jb250ZXh0IHx8IHt9IDoge30sXG4gICAgICBsb2NhbHM6IFwibG9jYWxzXCIgaW4gYXJncyA/IGFyZ3MubG9jYWxzIHx8IHt9IDoge31cbiAgICB9KVxuXG4gICAgLy8gTmFycm93cyB0aGUgc3ViY2xhc3Mgc3RhdGljIHNpZGUgdG8gdGhlIG1vZGVsIGNsYXNzIGNhcnJpZWQgYnkgdGhpcyByZXNvdXJjZSBnZW5lcmljLlxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlICYge01vZGVsQ2xhc3M6IFRNb2RlbENsYXNzIHwgdW5kZWZpbmVkLCBtb2RlbENsYXNzOiAoKSA9PiBUTW9kZWxDbGFzc319ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBcImNvbnRyb2xsZXJcIiBpbiBhcmdzID8gYXJncy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgdGhpcy5jb25maWd1cmF0aW9uVmFsdWUgPSBcImNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5jb25maWd1cmF0aW9uIDogdW5kZWZpbmVkXG4gICAgLy8gTmFycm93cyB0aGUgaW50ZXJuYWwgY29udHJvbGxlci9zaGFyZWQtcmVzb3VyY2UgY29uc3RydWN0aW9uIHBhdGggdG8gdGhlIHJlc291cmNlJ3MgZGVjbGFyZWQgbW9kZWwgZ2VuZXJpYy5cbiAgICB0aGlzLm1vZGVsQ2xhc3NWYWx1ZSA9IC8qKiBAdHlwZSB7VE1vZGVsQ2xhc3N9ICovIChcIm1vZGVsQ2xhc3NcIiBpbiBhcmdzID8gYXJncy5tb2RlbENsYXNzIDogUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkpXG4gICAgdGhpcy5tb2RlbE5hbWVWYWx1ZSA9IFwibW9kZWxOYW1lXCIgaW4gYXJncyA/IGFyZ3MubW9kZWxOYW1lIDogdGhpcy5tb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICB0aGlzLnBhcmFtc1ZhbHVlID0gXCJwYXJhbXNcIiBpbiBhcmdzID8gYXJncy5wYXJhbXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlID0gXCJyZXNvdXJjZUNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24gOiBkZWZhdWx0UmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25maWd1cmVkIHNoYXJlZCByZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNoYXJlZCByZXNvdXJjZSBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLlNoYXJlZFJlc291cmNlXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIHZhbHVlIGZyb20gdGhlIGVudmlyb25tZW50IHJlc291cmNlIGZpcnN0LFxuICAgKiB0aGVuIGZyb20gdGhlIHNoYXJlZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtcImFiaWxpdGllc1wiIHwgXCJhdHRhY2htZW50c1wiIHwgXCJhdHRyaWJ1dGVzXCIgfCBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIgfCBcImNvbGxlY3Rpb25Db21tYW5kc1wiIHwgXCJjb21tYW5kc1wiIHwgXCJtZW1iZXJDb21tYW5kc1wiIHwgXCJtb2RlbE5hbWVcIiB8IFwicHJpbWFyeUtleVwiIHwgXCJyZWxhdGlvbnNoaXBzXCIgfCBcInNlcnZlclwiIHwgXCJzeW5jXCIgfCBcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIgfCBcIndyaXRhYmxlQXR0cmlidXRlc1wifSBuYW1lIC0gU3RhdGljIGNvbmZpZyBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gUmVzb2x2ZWQgY29uZmlnIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUobmFtZSkge1xuICAgIGlmICh0aGlzW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzW25hbWVdXG5cbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlQ2xhc3MoKSlcblxuICAgIGlmICghU2hhcmVkUmVzb3VyY2UpIHJldHVybiB1bmRlZmluZWRcbiAgICBpZiAoU2hhcmVkUmVzb3VyY2VbbmFtZV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIFNoYXJlZFJlc291cmNlW25hbWVdXG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdHJhbnNsYXRlZCBhdHRyaWJ1dGVzIGZyb20gZW52aXJvbm1lbnQgYW5kIHNoYXJlZCByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gLSBUcmFuc2xhdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyB0cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGZyb250ZW5kLXNhZmUgYXR0YWNobWVudCBkZWNsYXJhdGlvbnMgZnJvbSB0aGUgYmFja2luZyBtb2RlbC5cbiAgICogUmVzb3VyY2UtbGV2ZWwgZGVjbGFyYXRpb25zIHJlbWFpbiBhcyBhIGZhbGxiYWNrIGZvciBmcm9udGVuZC1vbmx5IHJlc291cmNlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBDbGllbnQgYXR0YWNobWVudCBjb25maWd1cmF0aW9uIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudENvbmZpZ3VyYXRpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRhY2htZW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0YWNobWVudHNcIikpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBjb25maWd1cmVkQXR0YWNobWVudHMgPyB7Li4uY29uZmlndXJlZEF0dGFjaG1lbnRzfSA6IHt9XG5cbiAgICBpZiAoIXRoaXMuTW9kZWxDbGFzcykgcmV0dXJuIGF0dGFjaG1lbnRzXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgZGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5Nb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudENvbmZpZyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb259ICovICh7dHlwZTogZGVmaW5pdGlvbi50eXBlfSlcblxuICAgICAgaWYgKGRlZmluaXRpb24uc3luYykgYXR0YWNobWVudENvbmZpZy5zeW5jID0gey4uLmRlZmluaXRpb24uc3luY31cblxuICAgICAgYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudENvbmZpZ1xuICAgIH1cblxuICAgIHJldHVybiBhdHRhY2htZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJlc291cmNlIGluc3RhbmNlIGZvciBzaGFyZWQtcmVzb3VyY2UgZmFsbGJhY2sgY2FsbHMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9IC0gU2hhcmVkIHJlc291cmNlIGluc3RhbmNlIHdoZW4gY29uZmlndXJlZC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlSW5zdGFuY2UoKSB7XG4gICAgaWYgKHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgdW5kZWZpbmVkfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSB7XG4gICAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IG51bGxcbiAgICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuICAgIH1cblxuICAgIGlmIChTaGFyZWRSZXNvdXJjZSA9PT0gUmVzb3VyY2VDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke1Jlc291cmNlQ2xhc3MubmFtZX0uU2hhcmVkUmVzb3VyY2UgY2Fubm90IHBvaW50IHRvIGl0c2VsZi5gKVxuICAgIH1cblxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlQ29uc3RydWN0b3IgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3I8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoU2hhcmVkUmVzb3VyY2UpKVxuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gbmV3IFNoYXJlZFJlc291cmNlQ29uc3RydWN0b3Ioe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgY29udHJvbGxlcjogdGhpcy5jb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMubW9kZWxDbGFzcygpLFxuICAgICAgbW9kZWxOYW1lOiB0aGlzLm1vZGVsTmFtZSgpLFxuICAgICAgcGFyYW1zOiB0aGlzLnBhcmFtcygpLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvbigpXG4gICAgfSlcbiAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IHNoYXJlZFJlc291cmNlXG5cbiAgICByZXR1cm4gc2hhcmVkUmVzb3VyY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxscyBhIHNoYXJlZC1yZXNvdXJjZSBtZXRob2Qgb25seSB3aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ugb3ZlcnJpZGVzIHRoZSBmcmFtZXdvcmsgZGVmYXVsdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIE1ldGhvZCBhcmdzLlxuICAgKiBAcmV0dXJucyB7e2NhbGxlZDogYm9vbGVhbiwgcmVzdWx0OiB1bmtub3dufX0gLSBTaGFyZWQgbWV0aG9kIGNhbGwgcmVzdWx0LlxuICAgKi9cbiAgY2FsbFNoYXJlZFJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoIXNoYXJlZFJlc291cmNlKSByZXR1cm4ge2NhbGxlZDogZmFsc2UsIHJlc3VsdDogdW5kZWZpbmVkfVxuXG4gICAgY29uc3QgbWV0aG9kT3duZXIgPSBwcm90b3R5cGVPd25lckZvck1ldGhvZChzaGFyZWRSZXNvdXJjZSwgbWV0aG9kTmFtZSlcblxuICAgIGlmICghbWV0aG9kT3duZXIgfHwgbWV0aG9kT3duZXIgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlIHx8IG1ldGhvZE93bmVyID09PSBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlLnByb3RvdHlwZSkge1xuICAgICAgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc2hhcmVkUmVzb3VyY2UpKVttZXRob2ROYW1lXVxuXG4gICAgcmV0dXJuIHtjYWxsZWQ6IHRydWUsIHJlc3VsdDogbWV0aG9kLmFwcGx5KHNoYXJlZFJlc291cmNlLCBhcmdzKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNoYXJlZCBtZXRob2QgcmVzdWx0IG9yIGEgZmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBTaGFyZWQgbWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7dW5rbm93bltdfSBhcmdzIC0gU2hhcmVkIG1ldGhvZCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFJlc3VsdH0gZmFsbGJhY2sgLSBGYWxsYmFjayBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Jlc3VsdH0gLSBTaGFyZWQgb3IgZmFsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgc2hhcmVkUmVzb3VyY2VNZXRob2RPcihtZXRob2ROYW1lLCBhcmdzLCBmYWxsYmFjaykge1xuICAgIGNvbnN0IHNoYXJlZFJlc3VsdCA9IHRoaXMuY2FsbFNoYXJlZFJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUsIGFyZ3MpXG5cbiAgICBpZiAoc2hhcmVkUmVzdWx0LmNhbGxlZCkgcmV0dXJuIC8qKiBAdHlwZSB7UmVzdWx0fSAqLyAoc2hhcmVkUmVzdWx0LnJlc3VsdClcblxuICAgIHJldHVybiBmYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBtZXRob2Qgb24gdGhpcyByZXNvdXJjZSBvciBpdHMgc2hhcmVkIGZhbGxiYWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e21ldGhvZDogKC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93biwgcmVzb3VyY2U6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSB8IG51bGx9IC0gUmVzb2x2ZWQgbWV0aG9kIGFuZCByZWNlaXZlci5cbiAgICovXG4gIHJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUpIHtcbiAgICBjb25zdCBvd25NZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIG93bk1ldGhvZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBtZXRob2Q6IC8qKiBAdHlwZSB7KC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bn0gKi8gKG93bk1ldGhvZCksXG4gICAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNoYXJlZE1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzaGFyZWRSZXNvdXJjZSkpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIHNoYXJlZE1ldGhvZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAoc2hhcmVkTWV0aG9kKSxcbiAgICAgIHJlc291cmNlOiBzaGFyZWRSZXNvdXJjZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFiaWxpdGllcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWJpbGl0aWVzKCkge1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFiaWxpdGllc1wiLCBbXSwgKCkgPT4gdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHlwZWQgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IC0gQ29udHJvbGxlciBpbnN0YW5jZSB3aXRoIGZyb250ZW5kLW1vZGVsIGhlbHBlcnMuXG4gICAqL1xuICB0eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAqLyAodGhpcy5jb250cm9sbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIFN0YXRpYyByZXNvdXJjZSBjb25maWcgKHJhdyB1c2VyIGlucHV0IHNoYXBlOyBjb25zdW1lcnMgbm9ybWFsaXplKS5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0cmlidXRlc1wiKVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImFiaWxpdGllc1wiKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gdGhpcy5hdHRhY2htZW50Q29uZmlndXJhdGlvbnMoKVxuICAgIGNvbnN0IGNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiY29tbWFuZHNcIilcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiKVxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiKVxuICAgIGNvbnN0IGNvbGxlY3Rpb25Db21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImNvbGxlY3Rpb25Db21tYW5kc1wiKVxuICAgIGNvbnN0IG1lbWJlckNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibWVtYmVyQ29tbWFuZHNcIilcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtb2RlbE5hbWVcIilcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwicHJpbWFyeUtleVwiKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJyZWxhdGlvbnNoaXBzXCIpXG4gICAgY29uc3Qgc2VydmVyID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwic2VydmVyXCIpXG4gICAgY29uc3Qgc3luYyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInN5bmNcIilcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi9cbiAgICBjb25zdCBjb25maWcgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHN0cmluZ1tdfSAqLyAoYXR0cmlidXRlcyB8fCBbXSlcbiAgICB9XG5cbiAgICBpZiAoYWJpbGl0aWVzKSBjb25maWcuYWJpbGl0aWVzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGFiaWxpdGllcylcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIGNvbmZpZy5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKGNvbW1hbmRzKSBjb25maWcuY29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoY29tbWFuZHMpXG4gICAgaWYgKGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMpIGNvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMpXG4gICAgaWYgKGJ1aWx0SW5NZW1iZXJDb21tYW5kcykgY29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChidWlsdEluTWVtYmVyQ29tbWFuZHMpXG4gICAgaWYgKGNvbGxlY3Rpb25Db21tYW5kcykgY29uZmlnLmNvbGxlY3Rpb25Db21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChjb2xsZWN0aW9uQ29tbWFuZHMpXG4gICAgaWYgKG1lbWJlckNvbW1hbmRzKSBjb25maWcubWVtYmVyQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAobWVtYmVyQ29tbWFuZHMpXG4gICAgaWYgKG1vZGVsTmFtZSkgY29uZmlnLm1vZGVsTmFtZSA9IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAobW9kZWxOYW1lKVxuICAgIGlmIChwcmltYXJ5S2V5KSBjb25maWcucHJpbWFyeUtleSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgc3RyaW5nW119ICovIChwcmltYXJ5S2V5KVxuICAgIGlmIChyZWxhdGlvbnNoaXBzKSBjb25maWcucmVsYXRpb25zaGlwcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChyZWxhdGlvbnNoaXBzKVxuICAgIGlmIChzZXJ2ZXIpIGNvbmZpZy5zZXJ2ZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbn0gKi8gKHNlcnZlcilcbiAgICBpZiAoc3luYyAhPT0gdW5kZWZpbmVkKSBjb25maWcuc3luYyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbiB8IGJvb2xlYW59ICovIChzeW5jKVxuXG4gICAgcmV0dXJuIGNvbmZpZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjbGllbnQtZmFjaW5nIHJlc291cmNlIHByaW1hcnkga2V5IGZyb20gZXhwbGljaXQgcmVzb3VyY2UgY29uZmlnIG9yIHRoZSBiYWNraW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIFJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIENsaWVudC1mYWNpbmcgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzdGF0aWMgcmVzb2x2ZWRQcmltYXJ5S2V5KHJlc291cmNlQ29uZmlndXJhdGlvbikge1xuICAgIGlmIChyZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSkgcmV0dXJuIHJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5XG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHJldHVybiBcImlkXCJcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHRoaXMubW9kZWxDbGFzcygpKVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShtb2RlbFByaW1hcnlLZXkpXG4gICAgICA/IG1vZGVsUHJpbWFyeUtleS5tYXAoKGNvbHVtbk5hbWUpID0+IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29sdW1uTmFtZSkgfHwgY29sdW1uTmFtZSlcbiAgICAgIDogbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShtb2RlbFByaW1hcnlLZXkpIHx8IG1vZGVsUHJpbWFyeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBDb250cm9sbGVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIGlmICghdGhpcy5jb250cm9sbGVyKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcblxuICAgIHJldHVybiB0aGlzLmNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbjogdGhlIGNvbnRyb2xsZXIncyB3aGVuIHRoZSByZXNvdXJjZVxuICAgKiBzZXJ2ZXMgYSBjb250cm9sbGVyIHJlcXVlc3QsIG90aGVyd2lzZSB0aGUgY29uc3RydWN0b3ItaW5qZWN0ZWRcbiAgICogY29uZmlndXJhdGlvbiAoZm9yIGV4YW1wbGUgYSBzeW5jIHdlYnNvY2tldCBjaGFubmVsJ3MgcmVzb3VyY2UpLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgY29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250cm9sbGVyKSByZXR1cm4gdGhpcy5jb250cm9sbGVySW5zdGFuY2UoKS5nZXRDb25maWd1cmF0aW9uKClcbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uVmFsdWUpIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIG9yIGFuIGluamVjdGVkIGNvbmZpZ3VyYXRpb24uYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gTW9kZWwgY2xhc3MuXG4gICAqL1xuICBtb2RlbENsYXNzKCkge1xuICAgIGlmICghdGhpcy5tb2RlbENsYXNzVmFsdWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgY2xhc3MuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkYXRhYmFzZSBtb2RlbCBjbGFzcyB1c2VkIGJ5IHNlcnZlci1vbmx5IHJlc291cmNlIG9wZXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtURGF0YWJhc2VNb2RlbENsYXNzfSAtIERhdGFiYXNlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZGF0YWJhc2VNb2RlbENsYXNzKCkge1xuICAgIC8vIE5hcnJvd3MgdGhlIHBvcnRhYmxlIHJlc291cmNlIGdlbmVyaWMgYXQgdGhlIGV4cGxpY2l0IGJhY2tlbmQtb3BlcmF0aW9uIGJvdW5kYXJ5LlxuICAgIHJldHVybiAvKiogQHR5cGUge1REYXRhYmFzZU1vZGVsQ2xhc3N9ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzLm1vZGVsQ2xhc3MoKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1aXJlZCBtb2RlbCBjbGFzcyBmb3IgYXV0aG9yaXphdGlvbiBoZWxwZXJzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHJlcXVpcmVkTW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTW9kZWwgbmFtZS5cbiAgICovXG4gIG1vZGVsTmFtZSgpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxOYW1lVmFsdWUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgbmFtZS5gKVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxOYW1lVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcmFtcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAtIFBhcmFtcy5cbiAgICovXG4gIHBhcmFtcygpIHsgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9ICovICh0aGlzLnBhcmFtc1ZhbHVlIHx8IHN1cGVyLnBhcmFtcygpIHx8IHt9KSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IC0gUmVzb3VyY2UgY29uZmlnIChub3JtYWxpemVkIGF0IHJ1bnRpbWU7IHJhdyBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAgICovXG4gIHJlc291cmNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5gKVxuXG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgUmFpbHMtc3Ryb25nLXBhcmFtcyAvIGFwaV9tYWtlci1zdHlsZSBwZXJtaXQgc3BlYyBkZWNsYXJpbmdcbiAgICogd2hpY2ggYXR0cmlidXRlcyBhbmQgbmVzdGVkIGF0dHJpYnV0ZXMgYXJlIHdyaXRhYmxlIGZvciB0aGUgY3VycmVudFxuICAgKiByZXF1ZXN0LiBTdWJtaXR0aW5nIGFuIGF0dHJpYnV0ZSBvciBuZXN0ZWQtcmVsYXRpb25zaGlwIGtleSB0aGF0IGlzXG4gICAqIG5vdCBwZXJtaXR0ZWQgcmFpc2VzIGFuIGVycm9yIGFuZCBmYWlscyB0aGUgd3JpdGUuXG4gICAqXG4gICAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIGZsYXQgYXJyYXkgdGhhdCBtaXhlczpcbiAgICogICAtIGBcImF0dHJpYnV0ZU5hbWVcImAgc3RyaW5ncyBmb3IgcGxhaW4gYXR0cmlidXRlIHdyaXRlc1xuICAgKiAgIC0gYHs8cmVsYXRpb25zaGlwTmFtZT5BdHRyaWJ1dGVzOiBbLi4uXX1gIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlXG4gICAqICAgICBpcyBpdHNlbGYgYSBwZXJtaXQgc3BlYyBmb3IgdGhlIG5lc3RlZCByZWxhdGlvbnNoaXBcbiAgICpcbiAgICogVGhpcyBtYXRjaGVzIFJhaWxzIHN0cm9uZ19wYXJhbXMgKGBwZXJtaXQoOmZpcnN0X25hbWUsIDpsYXN0X25hbWUsXG4gICAqIGNvbnRhY3RfYXR0cmlidXRlczogWzplbWFpbCwgZGV0YWlsc19hdHRyaWJ1dGVzOiBbOmRldGFpbF1dKWApIGFuZFxuICAgKiB0aGUgYXBpX21ha2VyIHNpc3RlciBwcm9qZWN0LiBJbmNsdWRlIGBcIl9kZXN0cm95XCJgIGluc2lkZSBhIG5lc3RlZFxuICAgKiBwZXJtaXQgdG8gYWxsb3cgYF9kZXN0cm95OiB0cnVlYCBlbnRyaWVzIGZvciB0aGF0IHJlbGF0aW9uc2hpcCDigJRcbiAgICogdGhlIG1vZGVsIG11c3QgYWxzbyBkZWNsYXJlIGBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihuYW1lLFxuICAgKiB7YWxsb3dEZXN0cm95OiB0cnVlfSlgIGZvciB0aGUgZGVzdHJveSB0byBiZSBhcHBsaWVkLlxuICAgKlxuICAgKiBFeGFtcGxlOlxuICAgKlxuICAgKiAgIGNsYXNzIFByb2plY3RSZXNvdXJjZSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uge1xuICAgKiAgICAgcGVybWl0dGVkUGFyYW1zKGFyZykge1xuICAgKiAgICAgICByZXR1cm4gW1xuICAgKiAgICAgICAgIFwibmFtZVwiLFxuICAgKiAgICAgICAgIFwiZGVzY3JpcHRpb25cIixcbiAgICogICAgICAgICB7dGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiLFxuICAgKiAgICAgICAgICAge3N1YnRhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gICAqICAgICAgICAgXX1cbiAgICogICAgICAgXVxuICAgKiAgICAgfVxuICAgKiAgIH1cbiAgICpcbiAgICogRGVmYXVsdCBpbXBsZW1lbnRhdGlvbiByZXR1cm5zIHRoZSBkZWNsYXJlZFxuICAgKiB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS53cml0YWJsZUF0dHJpYnV0ZXN9IHBlcm1pdCBsaXN0LCBvciBgW11gXG4gICAqIOKAlCBub3RoaW5nIHBlcm1pdHRlZCDigJQgd2l0aG91dCBhIGRlY2xhcmVkIGxpc3QuIFN1YmNsYXNzZXMgb3ZlcnJpZGUgdG9cbiAgICogY3VzdG9taXplOyBhbiBleHBsaWNpdCBvdmVycmlkZSBhbHdheXMgd2lucy5cbiAgICogQHBhcmFtIHt7YWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYWJpbGl0eT86IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0LCBsb2NhbHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBbYXJnXSAtIFJlcXVlc3QgY29udGV4dC5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGVybWl0IHNwZWMuXG4gICAqL1xuICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcInBlcm1pdHRlZFBhcmFtc1wiLCBbYXJnXSwgKCkgPT4ge1xuICAgICAgdm9pZCBhcmdcblxuICAgICAgcmV0dXJuIHRoaXMuZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSA/PyBbXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCBmcm9tIHRoZSBlbnZpcm9ubWVudFxuICAgKiByZXNvdXJjZSBmaXJzdCwgdGhlbiB0aGUgc2hhcmVkIHJlc291cmNlIOKAlCBtaXJyb3JpbmcgaG93IHRoZSBvdGhlclxuICAgKiBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIHJlc29sdmVzLiBBbiBleHBsaWNpdCBlbnZpcm9ubWVudCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucyBvdmVyIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSBEZWNsYXJlZCBwZXJtaXQgbGlzdCBvciBudWxsIHdoZW4gdW5kZWNsYXJlZC5cbiAgICovXG4gIGRlY2xhcmVkV3JpdGFibGVBdHRyaWJ1dGVzKCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBwZXJtaXR0ZWRBdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWR9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIikpXG5cbiAgICByZXR1cm4gcGVybWl0dGVkQXR0cmlidXRlcyA/PyBudWxsXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBjbGllbnQtc2FmZSBlcnJvciB0aHJvd24gZm9yIGEgZmFpbGVkIHdyaXRhYmxlLWF0dHJpYnV0ZSB2YWxpZGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7Y2F1c2U/OiBFcnJvciwgY29kZTogc3RyaW5nfX0gZGV0YWlscyAtIFN0YWJsZSBtYWNoaW5lLXJlYWRhYmxlIGNvZGUgYW5kIG9wdGlvbmFsIGNhdXNlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IENsaWVudC1zYWZlIGVycm9yLlxuICAgKi9cbiAgd3JpdGFibGVBdHRyaWJ1dGVFcnJvcihtZXNzYWdlLCB7Y2F1c2UsIGNvZGV9KSB7XG4gICAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUobWVzc2FnZSwgY2F1c2UgPyB7Y2F1c2UsIGNvZGV9IDoge2NvZGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhvcml6ZXMgb25lIHJvdXRlZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBiZWZvcmUgaXQgaXMgYXBwbGllZC5cbiAgICogRGVmYXVsdHMgdG8gYWxsb3dpbmcgZXZlcnkgbXV0YXRpb247IHJlY29yZC1sZXZlbCBhdXRob3JpemF0aW9uIHN0aWxsXG4gICAqIGFwcGxpZXMgdGhyb3VnaCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNmaW5kU3luY1JlY29yZH0gc2NvcGluZ1xuICAgKiBhbmQgdGhlIGNyZWF0ZSBtZW1iZXJzaGlwIGNoZWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb24gfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbj59IEF1dGhvcml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXV0aG9yaXplU3luY011dGF0aW9uKHtjb250ZXh0LCBtdXRhdGlvbn0pIHtcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4ge2FsbG93ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcGVyLXN5bmMgZmFpbHVyZSByZWFzb24gcmVwb3J0ZWQgd2hlbiBhIHJvdXRlZCBzeW5jIG11dGF0aW9uXG4gICAqIGZhaWxzIHJlY29yZC1sZXZlbCBhdXRob3JpemF0aW9uLiBEZWZhdWx0cyB0byBudWxsLCB3aGljaCByZXBvcnRzIHRoZVxuICAgKiBnZW5lcmljIFwiYWNjZXNzLWRlbmllZFwiIHJlYXNvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGFyZ3MuYWN0aW9uIC0gRGVuaWVkIGFjdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSBvciBudWxsIGZvciB0aGUgZ2VuZXJpYyBkZWZhdWx0LlxuICAgKi9cbiAgc3luY0F1dGhvcml6YXRpb25GYWlsdXJlUmVhc29uKHthY3Rpb24sIG11dGF0aW9ufSkge1xuICAgIHZvaWQgYWN0aW9uXG4gICAgdm9pZCBtdXRhdGlvblxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZXhpc3RpbmcgcmVjb3JkIHRhcmdldGVkIGJ5IGEgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBEZWZhdWx0cyB0byBhbiBgYWNjZXNzaWJsZUZvcmAgbG9va3VwIGJ5IHByaW1hcnkga2V5IHRocm91Z2ggdGhlXG4gICAqIHJlc291cmNlJ3Mgbm9ybWFsaXplZCBhYmlsaXR5IGFjdGlvbiBmb3IgdXBkYXRlIChvciBkZXN0cm95IGZvciBkZWxldGVcbiAgICogbXV0YXRpb25zKSwgZmFsbGluZyBiYWNrIHRvIGFuIHVuc2NvcGVkIGxvb2t1cCB3aXRob3V0IGFuIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FyZ3MuYWJpbGl0eV0gLSBBYmlsaXR5IG92ZXJyaWRlLiBEZWZhdWx0cyB0byB0aGUgcmVzb3VyY2UgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5mb3JEZWxldGVdIC0gV2hldGhlciB0aGUgbG9va3VwIGlzIGZvciBhIGRlbGV0ZSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IEV4aXN0aW5nIHJlY29yZCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZmluZFN5bmNSZWNvcmQoe2FiaWxpdHkgPSB0aGlzLmFiaWxpdHksIGZvckRlbGV0ZSA9IGZhbHNlLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyBNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5zeW5jQWJpbGl0eUFjdGlvbihmb3JEZWxldGUgPyBcImRlc3Ryb3lcIiA6IFwidXBkYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgOiBNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHRoaXMuZGF0YWJhc2VQcmltYXJ5S2V5KCksIG11dGF0aW9uLnJlc291cmNlSWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcHMgYSByYXcgc3luYyBhY3Rpb24gdG8gdGhlIHJlc291cmNlJ3Mgbm9ybWFsaXplZCBhYmlsaXR5IGFjdGlvbiB3aGVuXG4gICAqIHRoZSByZXNvdXJjZSBjb25maWd1cmF0aW9uIGRlY2xhcmVzIGFuIGFiaWxpdGllcyBtYXBwaW5nLCBvdGhlcndpc2UgdGhlXG4gICAqIHJhdyBhY3Rpb24gbmFtZSBpcyB1c2VkIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGFjdGlvbiAtIFJhdyBzeW5jIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gQWJpbGl0eSBhY3Rpb24uXG4gICAqL1xuICBzeW5jQWJpbGl0eUFjdGlvbihhY3Rpb24pIHtcbiAgICBjb25zdCBhYmlsaXRpZXMgPSB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlPy5hYmlsaXRpZXNcblxuICAgIGlmIChhYmlsaXRpZXMgJiYgdHlwZW9mIGFiaWxpdGllcyA9PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFiaWxpdGllcylbYWN0aW9uXVxuXG4gICAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gPT0gXCJzdHJpbmdcIiAmJiBhYmlsaXR5QWN0aW9uLmxlbmd0aCA+IDApIHJldHVybiBhYmlsaXR5QWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIGFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZ1bGwgZXNjYXBlIGhhdGNoIGZvciByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi4gUmV0dXJuaW5nIGFcbiAgICogbm9uLW51bGwgcmVzdWx0IHJlcGxhY2VzIHRoZSB3aG9sZSBkZWZhdWx0IGFwcGx5IGZsb3cgKGF1dGhvcml6YXRpb24sXG4gICAqIHJlY29yZCBsb29rdXAsIG5vcm1hbGl6YXRpb24gYW5kIHNhdmUpIHdpdGggdGhlIHJldHVybmVkIGFwcGx5IHJlc3VsdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXBwbHlTeW5jQXJnc30gYXJncyAtIEFwcGx5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0IHwgbnVsbCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGw+fSBBcHBseSByZXN1bHQgb3IgbnVsbCBmb3IgdGhlIGRlZmF1bHQgZmxvdy5cbiAgICovXG4gIGFwcGx5U3luYyhhcmdzKSB7XG4gICAgdm9pZCBhcmdzXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgYSByb3V0ZWQgc3luYyBtdXRhdGlvbiB3YXMgYXBwbGllZC4gUmV0dXJuZWQgZW50cmllcyBhcmVcbiAgICogbWVyZ2VkIGludG8gdGhlIGFwcGx5IHJlc3VsdCwgcmVhY2hpbmcgcGVyc2lzdEV4dHJhQXR0cmlidXRlcyBhbmRcbiAgICogYnJvYWRjYXN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jcmVhdGVkIC0gV2hldGhlciB0aGUgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGFyZ3MucmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gRXh0cmEgYXBwbHktcmVzdWx0IGVudHJpZXMuXG4gICAqL1xuICBhZnRlclN5bmNBcHBseSh7Y29udGV4dCwgY3JlYXRlZCwgbXV0YXRpb24sIHJlY29yZH0pIHtcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIGNyZWF0ZWRcbiAgICB2b2lkIG11dGF0aW9uXG4gICAgdm9pZCByZWNvcmRcblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY3JlYXRlIGF0dHJpYnV0ZXMgYmVmb3JlIHBlcm1pc3Npb24gZmlsdGVyaW5nIGFuZCBzYXZpbmcuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIEluY29taW5nIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZD59IC0gTm9ybWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcIm5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXNcIiwgW2F0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgdXBkYXRlIGF0dHJpYnV0ZXMgYmVmb3JlIHBlcm1pc3Npb24gZmlsdGVyaW5nIGFuZCBzYXZpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIEluY29taW5nIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZD59IC0gTm9ybWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVVcGRhdGVBdHRyaWJ1dGVzXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgb3B0aW9uc1xuXG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgY3JlYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE5ldyBtb2RlbCBiZWZvcmUgYXNzaWdubWVudC9zYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZUNyZWF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVDcmVhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgY3JlYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIENyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJDcmVhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbCBiZWZvcmUgYXNzaWdubWVudC9zYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZVVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVVcGRhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJVcGRhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVEZXN0cm95XCIsIFttb2RlbF0sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBEZXN0cm95ZWQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJEZXN0cm95KG1vZGVsKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXcmFwcyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgcmVzb3VyY2UgbXV0YXRpb25zLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gYXJncy5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIE11dGF0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE11dGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXN1bHQ+fSBhcmdzLmNhbGxiYWNrIC0gTXV0YXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTXV0YXRpb25UcmFuc2FjdGlvbih7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcInJ1bk11dGF0aW9uVHJhbnNhY3Rpb25cIiwgW3thY3Rpb24sIG1vZGVsLCBjYWxsYmFja31dLCBhc3luYyAoKSA9PiB7XG4gICAgICB2b2lkIGFjdGlvblxuICAgICAgdm9pZCBtb2RlbFxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gUHJpbWFyeSBrZXkuXG4gICAqL1xuICBwcmltYXJ5S2V5KCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcblxuICAgIHJldHVybiBSZXNvdXJjZUNsYXNzLnJlc29sdmVkUHJpbWFyeUtleSh0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvbigpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGF0YWJhc2UgcHJpbWFyeSBrZXkuXG4gICAqXG4gICAqIERlY2xhcmVkIHNjYWxhciByZXNvdXJjZSBwcmltYXJ5IGtleXMgYXJlIGNsaWVudC1mYWNpbmcgYWxpYXNlcyAoZm9yIGV4YW1wbGVcbiAgICogYSBjYW1lbENhc2UgbmFtZSBmb3IgYSBsZWdhY3kgcmF3LWNvbHVtbiBwcmltYXJ5IGtleSkuIERhdGFiYXNlLWZhY2luZyBpZGVudGl0eVxuICAgKiBvcGVyYXRpb25zIG11c3QgcmVzb2x2ZSB0aGUgYWxpYXMgdG8gdGhlIG1vZGVsJ3MgY2Fub25pY2FsIGF0dHJpYnV0ZSBzbyB3aGVyZVxuICAgKiBhbmQgcGx1Y2sgY2xhdXNlcyBoaXQgcmVhbCBjb2x1bW5zLCB3aGlsZSBjbGllbnQtZmFjaW5nIHBheWxvYWRzIGtlZXAgdGhlIGFsaWFzLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gLSBQcmltYXJ5IGtleSByZXNvbHZlZCB0byBkYXRhYmFzZS1xdWVyeWFibGUgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgZGF0YWJhc2VQcmltYXJ5S2V5KCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnByaW1hcnlLZXkoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHJldHVybiBwcmltYXJ5S2V5XG5cbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUocHJpbWFyeUtleSkgfHwgcHJpbWFyeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXV0aG9yaXplZCBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb259IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF1dGhvcml6ZWRRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIEF1dGhvcml6YXRpb24gcXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIGF1dGhvcml6ZWRRdWVyeShhY3Rpb24sIG9wdGlvbnMpIHtcbiAgICAvLyBOYXJyb3dzIHRoZSBjb250cm9sbGVyIHF1ZXJ5IHRvIHRoaXMgcmVzb3VyY2UncyBtb2RlbCBjbGFzcy5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5KGFjdGlvbiwgb3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59IC0gRnJvbnRlbmQtbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqL1xuICBpbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEluZGV4UXVlcnkoe1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBwYWdpbmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9ufSBhcmdzLnBhZ2luYXRpb24gLSBQYWdpbmF0aW9uIHBhcmFtcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4UGFnaW5hdGlvbih7Y29udHJvbGxlciwgcGFnaW5hdGlvbiwgcXVlcnl9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtwYWdpbmF0aW9uLCBxdWVyeX0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBzZWFyY2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlciwgcXVlcnksIHNlYXJjaH0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaCh7cXVlcnksIHNlYXJjaH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBzb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNvcnQgYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9IGFyZ3Muc29ydCAtIFNvcnQgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydCh7Y29udHJvbGxlciwgcXVlcnksIHNvcnR9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTb3J0KHtxdWVyeSwgc29ydH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBwbHVjay5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBwbHVjayBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c1BsdWNrKGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLnJlY29yZHMgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLnJlY29yZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGNvdW50LlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNvdW50IGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQ291bnQoYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykucmVjb3JkcyA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUucmVjb3JkcyB8fFxuICAgICAgT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLmNvdW50ICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5jb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IHZvaWQgfCBQcm9taXNlPGJvb2xlYW4gfCB2b2lkPn0gLSBDb250aW51ZSBwcm9jZXNzaW5nIHVubGVzcyBmYWxzZS5cbiAgICovXG4gIGJlZm9yZUFjdGlvbihhY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQWN0aW9uXCIsIFthY3Rpb25dLCAoKSA9PiB7XG4gICAgICB2b2lkIGFjdGlvblxuXG4gICAgICAvLyBOby1vcCBieSBkZWZhdWx0LlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBSZWNvcmRzIGZvciBpbmRleCBhY3Rpb24uXG4gICAqL1xuICBhc3luYyByZWNvcmRzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmluZGV4UXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5IG9wdGlvbnMgZm9yIGNvdW50LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnN9IC0gSW5kZXggcXVlcnkgb3B0aW9ucyBmb3IgY291bnQuXG4gICAqL1xuICBjb3VudEluZGV4UXVlcnlPcHRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVjb3JkcyBjb3VudCBmb3IgaW5kZXggYWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5kZXhRdWVyeSh0aGlzLmNvdW50SW5kZXhRdWVyeU9wdGlvbnMoKSkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHBhcmFtIHtcImZpbmRcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gUmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIExvY2F0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kKGFjdGlvbiwgaWQpIHtcbiAgICBsZXQgcXVlcnkgPSB0aGlzLmF1dGhvcml6ZWRRdWVyeShhY3Rpb24pXG4gICAgY29uc3QgcHJlbG9hZCA9IGFjdGlvbiA9PT0gXCJmaW5kXCIgPyB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbFByZWxvYWQoKSA6IG51bGxcblxuICAgIGlmIChwcmVsb2FkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQocHJlbG9hZClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZmluZEJ5KG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnModGhpcy5kYXRhYmFzZVByaW1hcnlLZXkoKSwgaWQpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBDcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQ3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRTcGxpdCA9IHRoaXMuX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsKVxuICAgIGNvbnN0IHBlcm1pdCA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwiY3JlYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiBub3JtYWxpemVkQXR0cmlidXRlc30pKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKE1vZGVsQ2xhc3MucHJvdG90eXBlLCBNb2RlbENsYXNzLCBhdHRhY2htZW50U3BsaXQuYXR0cmlidXRlcywgdGhpcywgcGVybWl0LmF0dHJpYnV0ZXMpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJjcmVhdGVcIixcbiAgICAgIG1vZGVsLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWZvcmVDcmVhdGUobW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgICAgICBjb25zdCBzYXZlZE1vZGVsID0gYXdhaXQgdGhpcy5fc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnM6IHsuLi5vcHRpb25zLCBhdHRhY2htZW50czogYXR0YWNobWVudFNwbGl0LmF0dGFjaG1lbnRzfSwgcGVybWl0fSlcblxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyQ3JlYXRlKHNhdmVkTW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuXG4gICAgICAgIHJldHVybiBzYXZlZE1vZGVsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB1bmF1dGhvcml6ZWQgY3JlYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDbGVhbnVwIGFmdGVyIGZhaWxlZCBhdXRob3JpemF0aW9uLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlVW5hdXRob3JpemVkQ3JlYXRlZE1vZGVsKG1vZGVsKSB7XG4gICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIFVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBVcGRhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwsIG1vZGVsLmdldE1vZGVsQ2xhc3MoKSwgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlVXBkYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclVwZGF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgYSBtb2RlbCBhbmQgYXBwbGllcyBuZXN0ZWQgYXR0cmlidXRlcyBpbiBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7e2ZpbHRlcmVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG1vZGVsOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgb3B0aW9uczogRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnMsIHBlcm1pdDoge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19fSBhcmdzIC0gU2F2ZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBTYXZlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9ucywgcGVybWl0fSkge1xuICAgIGF3YWl0IHRoaXMuZGF0YWJhc2VNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKG1vZGVsLCBmaWx0ZXJlZClcbiAgICAgIHRoaXMuX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgICBpZiAob3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhtb2RlbCwgb3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmNvbnRyb2xsZXIgfHwgbnVsbCwgcGVybWl0KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtb2RlbC5zYXZlKClcblxuICAgICAgaWYgKG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMobW9kZWwsIG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcywgb3B0aW9ucy5jb250cm9sbGVyIHx8IG51bGwsIHBlcm1pdClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fcHJlbG9hZE5lc3RlZFdyaXRhYmxlUmVsYXRpb25zaGlwcyhtb2RlbCwgcGVybWl0KVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBhdHRyaWJ1dGVzIHRvIGEgbW9kZWwsIHVzaW5nIHZpcnR1YWwgc2V0dGVycyBvbiB0aGUgcmVzb3VyY2Ugd2hlbiBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhtb2RlbCwgYXR0cmlidXRlcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGRpcmVjdEF0dHJpYnV0ZXMgPSB7fVxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldChSZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW10pXG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUobmFtZSl9QXR0cmlidXRlYFxuICAgICAgY29uc3QgcmVzb3VyY2VTZXR0ZXIgPSB0aGlzLnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgICAgaWYgKHJlc291cmNlU2V0dGVyKSB7XG4gICAgICAgIGF3YWl0IHJlc291cmNlU2V0dGVyLm1ldGhvZC5jYWxsKHJlc291cmNlU2V0dGVyLnJlc291cmNlLCBtb2RlbCwgdmFsdWUpXG4gICAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKG5hbWUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpcmVjdEF0dHJpYnV0ZXNbbmFtZV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkaXJlY3RBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBtb2RlbC5hc3NpZ24oZGlyZWN0QXR0cmlidXRlcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIGF0dGFjaG1lbnQtbmFtZWQgYXR0cmlidXRlcyBpbnRvIHRoZSBhdHRhY2htZW50IHBheWxvYWQgd2hpbGUgcHJlc2VydmluZyBsZWdhY3kgY2FsbGVyc1xuICAgKiB0aGF0IHN1Ym1pdHRlZCBhdHRhY2htZW50cyBhcyBub3JtYWwgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gRXhwbGljaXQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXR0YWNobWVudHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9fSBBdHRyaWJ1dGVzIHdpdGggYXR0YWNobWVudCBrZXlzIHJlbW92ZWQgYW5kIG1lcmdlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBfZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzKSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gdGhpcy5tb2RlbENsYXNzKCkuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dGFjaG1lbnREZWZpbml0aW9ucykpXG5cbiAgICBpZiAoYXR0YWNobWVudE5hbWVzLnNpemUgPT09IDApIHJldHVybiB7YXR0cmlidXRlcywgYXR0YWNobWVudHN9XG5cbiAgICBpZiAoYXR0YWNobWVudHMgIT09IG51bGwgJiYgIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVndWxhckF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gKi9cbiAgICBsZXQgbWVyZ2VkQXR0YWNobWVudHMgPSBhdHRhY2htZW50cyA/IHsuLi5hdHRhY2htZW50c30gOiBudWxsXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0YWNobWVudE5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICByZWd1bGFyQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWVyZ2VkQXR0YWNobWVudHMpIG1lcmdlZEF0dGFjaG1lbnRzID0ge31cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobWVyZ2VkQXR0YWNobWVudHMsIGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAnJHthdHRyaWJ1dGVOYW1lfScgd2FzIHN1Ym1pdHRlZCBpbiBib3RoIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzLmApXG4gICAgICB9XG5cbiAgICAgIG1lcmdlZEF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4ge2F0dHJpYnV0ZXM6IHJlZ3VsYXJBdHRyaWJ1dGVzLCBhdHRhY2htZW50czogbWVyZ2VkQXR0YWNobWVudHN9XG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGF0dGFjaG1lbnQgcGF5bG9hZHMgb24gYSBtb2RlbCBhZnRlciB2YWxpZGF0aW5nIHBlcm1pdHMgYW5kIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgcmVjZWl2aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gQXR0YWNobWVudHMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyAtIEF0dHJpYnV0ZS9hdHRhY2htZW50IG5hbWVzIHBlcm1pdHRlZCBieSB0aGUgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBhdHRhY2htZW50cywgcGVybWl0dGVkQXR0cmlidXRlTmFtZXMpIHtcbiAgICBpZiAoIWF0dGFjaG1lbnRzKSByZXR1cm5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICBjb25zdCBwZXJtaXRTZXQgPSBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbC5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBtb2RlbENsYXNzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzID0gW11cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGludmFsaWRBdHRhY2htZW50cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgaWYgKCFwZXJtaXRTZXQuaGFzKGF0dGFjaG1lbnROYW1lKSkge1xuICAgICAgICBub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbnNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICAgIGludmFsaWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5xdWV1ZUF0dGFjaCh2YWx1ZSlcbiAgICB9XG5cbiAgICBpZiAobm90UGVybWl0dGVkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgRnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lcyBub3QgcGVybWl0dGVkIGJ5IHBlcm1pdHRlZFBhcmFtcygpOiAke25vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gICAgfVxuICAgIGlmIChpbnZhbGlkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgSW52YWxpZCBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IG5hbWVzOiAke2ludmFsaWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgb24gYSBtb2RlbCB2aWEgdGhlIHRyYW5zbGF0aW9ucyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSB2YWx1ZSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29udGV4dD8uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGxvY2FsZSA9IGNvbmZpZ3VyYXRpb24gPyBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpIDogXCJlblwiXG4gICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRyYW5zbGF0aW9uXG5cbiAgICBpZiAobW9kZWwuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChcInRyYW5zbGF0aW9uc1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgIHRyYW5zbGF0aW9uID0gbG9hZGVkLmZpbmQoKHQpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodCkubG9jYWxlKCkgPT09IGxvY2FsZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXRyYW5zbGF0aW9uKSB7XG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0ge31cblxuICAgIGFzc2lnbm1lbnRzW25hbWVdID0gdmFsdWVcbiAgICB0cmFuc2xhdGlvbi5hc3NpZ24oYXNzaWdubWVudHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KG1vZGVsKSB7XG4gICAgYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlRGVzdHJveShtb2RlbClcbiAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJEZXN0cm95KG1vZGVsKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgdG8gc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9IFthY3Rpb25dIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNlcmlhbGl6ZWQgbW9kZWwgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZShtb2RlbCwgYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuc2VyaWFsaXplRnJvbnRlbmRNb2RlbChtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb21tb24gbWV0YWRhdGEgZm9yIG9uZSBuZXN0ZWQtYXR0cmlidXRlcyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIHJlY2VpdmluZyBuZXN0ZWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IGFyZ3MucmF3RW50cmllcyAtIFJhdyBuZXN0ZWQgZW50cmllcyBmcm9tIHRoZSByZXF1ZXN0IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MuY2hpbGRQZXJtaXQgLSBQYXJzZWQgY2hpbGQgcGVybWl0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciBjaGlsZCByZXNvdXJjZSBsb29rdXAuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0eTogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGNoaWxkUHJpbWFyeUtleTogaW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbiwgY2hpbGRSZXNvdXJjZTogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSwgY2hpbGRSZXNvdXJjZUNvbmZpZzogRnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogc3RyaW5nW10sIGRlc3Ryb3lQZXJtaXR0ZWQ6IGJvb2xlYW4sIGVudHJpZXM6IEFycmF5PEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5PiwgcmVsYXRpb25zaGlwOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQsIHRhcmdldE1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH19IE5lc3RlZCByZWxhdGlvbnNoaXAgY29udGV4dC5cbiAgICovXG4gIF9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtwYXJlbnQsIHJlbGF0aW9uc2hpcE5hbWUsIHJhd0VudHJpZXMsIGNoaWxkUGVybWl0LCBjb250cm9sbGVyfSkge1xuICAgIGlmICghY29udHJvbGxlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nIHJlcXVpcmUgYSBjb250cm9sbGVyIGluc3RhbmNlLmApXG4gICAgfVxuXG4gICAgY29uc3QgcGFyZW50TW9kZWxDbGFzcyA9IHBhcmVudC5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBtb2RlbEFjY2VwdGFuY2UgPSBwYXJlbnRNb2RlbENsYXNzLmFjY2VwdGVkTmVzdGVkQXR0cmlidXRlc0ZvcihyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgaWYgKCFtb2RlbEFjY2VwdGFuY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTW9kZWwgJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IGFjY2VwdCBuZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBEZWNsYXJlIGl0IHZpYSAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nKS5gKVxuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHBhcmVudE1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwVHlwZSA9IHJlbGF0aW9uc2hpcC5nZXRUeXBlKClcbiAgICBjb25zdCByYXdOb3JtYWxpemVkRW50cmllcyA9IHRoaXMuX25lc3RlZFJlbGF0aW9uc2hpcEVudHJpZXMoe3Jhd0VudHJpZXMsIHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFR5cGV9KVxuICAgIGNvbnN0IGRlc3Ryb3lQZXJtaXR0ZWQgPSBjaGlsZFBlcm1pdC5hdHRyaWJ1dGVzLmluY2x1ZGVzKFwiX2Rlc3Ryb3lcIilcblxuICAgIGlmIChkZXN0cm95UGVybWl0dGVkICYmICFtb2RlbEFjY2VwdGFuY2UuYWxsb3dEZXN0cm95KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlIHBlcm1pdHMgX2Rlc3Ryb3kgb24gbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCB0aGUgbW9kZWwgJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9IGRvZXMgbm90IGFsbG93IGRlc3Ryb3kgZm9yIHRoYXQgcmVsYXRpb25zaGlwLiBTZXQge2FsbG93RGVzdHJveTogdHJ1ZX0gb24gJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9LmFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKCcke3JlbGF0aW9uc2hpcE5hbWV9JywgLi4uKS5gKVxuICAgIH1cbiAgICBpZiAodHlwZW9mIG1vZGVsQWNjZXB0YW5jZS5saW1pdCA9PT0gXCJudW1iZXJcIiAmJiByYXdOb3JtYWxpemVkRW50cmllcy5sZW5ndGggPiBtb2RlbEFjY2VwdGFuY2UubGltaXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGV4Y2VlZHMgbW9kZWwtZGVjbGFyZWQgbGltaXQgb2YgJHttb2RlbEFjY2VwdGFuY2UubGltaXR9LmApXG4gICAgfVxuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlICE9PSBcImhhc01hbnlcIiAmJiByYXdOb3JtYWxpemVkRW50cmllcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBhY2NlcHRzIG9uZSBlbnRyeSBmb3IgJHtyZWxhdGlvbnNoaXBUeXBlfSByZWxhdGlvbnNoaXBzLmApXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgcmVzb2x2ZWQgZm9yIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScgb24gJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9LmApXG4gICAgfVxuXG4gICAgY29uc3QgY2hpbGRSZXNvdXJjZUNvbmZpZyA9IGNvbnRyb2xsZXIuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3ModGFyZ2V0TW9kZWxDbGFzcylcblxuICAgIGlmICghY2hpbGRSZXNvdXJjZUNvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RlcmVkIGZvciBjaGlsZCBtb2RlbCAnJHt0YXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfScgdW5kZXIgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9Jy5gKVxuICAgIH1cblxuICAgIGNvbnN0IENoaWxkUmVzb3VyY2UgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yKGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDbGFzcylcbiAgICBjb25zdCBjaGlsZFJlc291cmNlID0gbmV3IENoaWxkUmVzb3VyY2Uoe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCB8fCB7fSxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgbW9kZWxOYW1lOiBjaGlsZFJlc291cmNlQ29uZmlnLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogY29udHJvbGxlci5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfSlcbiAgICBjb25zdCBjaGlsZFByaW1hcnlLZXkgPSBjaGlsZFJlc291cmNlLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiX2Rlc3Ryb3lcIilcbiAgICBjb25zdCBlbnRyaWVzID0gcmF3Tm9ybWFsaXplZEVudHJpZXNcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGNoaWxkUHJpbWFyeUtleSwgZW50cnksIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSlcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgcmV0dXJuICFtb2RlbEFjY2VwdGFuY2UucmVqZWN0SWYoaXNQbGFpbk9iamVjdChlbnRyeS5hdHRyaWJ1dGVzKSA/IGVudHJ5LmF0dHJpYnV0ZXMgOiB7fSlcbiAgICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0eTogY29udHJvbGxlci5jdXJyZW50QWJpbGl0eSgpIHx8IHRoaXMuYWJpbGl0eSxcbiAgICAgIGNoaWxkUHJpbWFyeUtleSxcbiAgICAgIGNoaWxkUmVzb3VyY2UsXG4gICAgICBjaGlsZFJlc291cmNlQ29uZmlnLFxuICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICBkZXN0cm95UGVybWl0dGVkLFxuICAgICAgZW50cmllcyxcbiAgICAgIHJlbGF0aW9uc2hpcCxcbiAgICAgIHRhcmdldE1vZGVsQ2xhc3NcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBuZXN0ZWQgZW50cmllcyBmb3IgY29sbGVjdGlvbiBhbmQgc2luZ3VsYXIgcmVsYXRpb25zaGlwcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOZXN0ZWQgZW50cmllcyBpbnB1dHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwVHlwZSAtIFJlbGF0aW9uc2hpcCB0eXBlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeSBvYmplY3RzLlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcEVudHJpZXMoe3Jhd0VudHJpZXMsIHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFR5cGV9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcnJheSBmb3IgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCBnb3Q6ICR7dHlwZW9mIHJhd0VudHJpZXN9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJhd0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyaWVzIG11c3QgYmUgb2JqZWN0cy5gKVxuXG4gICAgICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKGVudHJ5KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAocmF3RW50cmllcyA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyYXdFbnRyaWVzKSkge1xuICAgICAgcmV0dXJuIHJhd0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyaWVzIG11c3QgYmUgb2JqZWN0cy5gKVxuXG4gICAgICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKGVudHJ5KVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHJhd0VudHJpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCBmb3IgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCBnb3Q6ICR7dHlwZW9mIHJhd0VudHJpZXN9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICByZXR1cm4gWy8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChyYXdFbnRyaWVzKV1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXN0ZWQgZW50cnkgZnJvbSBlaXRoZXIgaW50ZXJuYWwgdHJhbnNwb3J0IHNoYXBlXG4gICAqIChge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzLCBuZXN0ZWRBdHRyaWJ1dGVzfWApIG9yIGRpcmVjdCBSYWlscy1zdHlsZVxuICAgKiBmaWVsZHMgKGB7bmFtZSwgZmlsZSwgY29tbWVudHNBdHRyaWJ1dGVzfWApLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5vcm1hbGl6YXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdCBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MuY2hpbGRQcmltYXJ5S2V5IC0gUmVzb2x2ZWQgY2hpbGQgcmVzb3VyY2UgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9IGFyZ3MuZW50cnkgLSBSYXcgbmVzdGVkIGVudHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkuXG4gICAqL1xuICBfbm9ybWFsaXplTmVzdGVkUmVsYXRpb25zaGlwRW50cnkoe2NoaWxkUGVybWl0LCBjaGlsZFByaW1hcnlLZXksIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIikge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjaGlsZFByaW1hcnlLZXkpKSB7XG4gICAgICAgICAgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhjaGlsZFByaW1hcnlLZXksIHZhbHVlKVxuICAgICAgICAgIG5vcm1hbGl6ZWQuaWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAqLyAodmFsdWUpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGlkIG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLmApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbm9ybWFsaXplZC5pZCA9IHZhbHVlXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IF9kZXN0cm95IG11c3QgYmUgYSBib29sZWFuLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLl9kZXN0cm95ID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0YWNobWVudHNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRhY2htZW50cyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dGFjaG1lbnRzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwibmVzdGVkQXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IG5lc3RlZEF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihuZXN0ZWRBdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbmVzdGVkIGF0dHJpYnV0ZXMga2V5OiAke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgICAgaWYgKCFjaGlsZFBlcm1pdC5uZXN0ZWRbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgdW5kZXIgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBJbmNsdWRlIHske2F0dHJpYnV0ZU5hbWV9OiBbLi4uXX0gaW4gdGhhdCBuZXN0ZWQgcGVybWl0LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1thdHRyaWJ1dGVOYW1lXSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBiZWxvbmdzLXRvIG5lc3RlZCBhdHRyaWJ1dGVzIGJlZm9yZSB0aGUgcGFyZW50IHNhdmUgc28gdGhlIHBhcmVudCBGSyBjYW4gYmUgc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChjb250ZXh0LnJlbGF0aW9uc2hpcCwgcGFyZW50LmdldE1vZGVsQ2xhc3MoKSlcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG5cbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICAgIGNoaWxkUHJpbWFyeUtleTogY29udGV4dC5jaGlsZFByaW1hcnlLZXksXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuZGVzdHJveShleGlzdGluZylcbiAgICAgICAgICBwYXJlbnQuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIG51bGwpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcbiAgICAgICAgY29uc3QgY2hpbGQgPSBpZCAhPSB1bmRlZmluZWRcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgICAgICAgY2hpbGRQcmltYXJ5S2V5OiBjb250ZXh0LmNoaWxkUHJpbWFyeUtleSxcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgICA6IG5ldyBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogY29udGV4dC5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgICAgICBlbnRyeVxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcyB8fCB7fSwgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIGF3YWl0IGNoaWxkLnNhdmUoKVxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG5cbiAgICAgICAgcGFyZW50LnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShjaGlsZC5pZCgpLCBgTmVzdGVkIGJlbG9uZ3MtdG8gd3JpdGUgZm9yICR7Y2hpbGQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCkpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSBgbmVzdGVkQXR0cmlidXRlc2AgcGF5bG9hZCB0byBhIGZyZXNobHktc2F2ZWQgcGFyZW50IG1vZGVsLFxuICAgKiBjYXNjYWRpbmcgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IHdyaXRlcyBhY3Jvc3MgdGhlIGRlY2xhcmVkIHJlbGF0aW9uc2hpcHMuXG4gICAqXG4gICAqIEVhY2ggY2hpbGQgaXMgYXV0aG9yaXplZCBhZ2FpbnN0IGl0cyBvd24gcmVzb3VyY2UncyBhYmlsaXRpZXMgKG5ldmVyIHRoZVxuICAgKiBwYXJlbnQncykuIERlc3Ryb3lzIHJ1biBiZWZvcmUgdXBkYXRlcywgdXBkYXRlcyBiZWZvcmUgY3JlYXRlcywgdG8gYXZvaWRcbiAgICogdW5pcXVlLWNvbnN0cmFpbnQgY29uZmxpY3RzIHdoZW4gcmVwbGFjaW5nIGEgY2hpbGQgYXQgdGhlIHNhbWUgbmF0dXJhbCBrZXkuXG4gICAqXG4gICAqIEF0dHJpYnV0ZSBmaWx0ZXJpbmcgZm9yIG5lc3RlZCBjaGlsZHJlbiB1c2VzIHRoZSBwYXJlbnQgcmVzb3VyY2Unc1xuICAgKiBwZXJtaXQgc3BlYyBmb3IgdGhhdCByZWxhdGlvbnNoaXAg4oCUIGFwaV9tYWtlci1zdHlsZS4gUG9saWN5IG9wdGlvbnNcbiAgICogKGFsbG93RGVzdHJveSwgbGltaXQsIHJlamVjdElmKSBjb21lIGZyb20gdGhlIE1PREVMJ3NcbiAgICogYGFjY2VwdGVkTmVzdGVkQXR0cmlidXRlc0ZvcihuYW1lKWAgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBuZXN0ZWRBdHRyaWJ1dGVzIC0gTmVzdGVkLWF0dHJpYnV0ZSBwYXlsb2FkIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBjb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgcmVzb3VyY2UgcmVzb2x1dGlvbiBhbmQgYXV0aG9yaXphdGlvbi5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IG51bGx9IFtwYXJlbnRQZXJtaXRdIC0gUGFyc2VkIHBhcmVudCBwZXJtaXQgc3BlYy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKHBhcmVudCwgbmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgcGFyZW50UGVybWl0ID0gbnVsbCkge1xuICAgIGNvbnN0IHJlc29sdmVkUGFyZW50ID0gcGFyZW50UGVybWl0XG4gICAgICB8fCBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczoge319KSlcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgY2hpbGRQZXJtaXQgPSByZXNvbHZlZFBhcmVudC5uZXN0ZWRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFjaGlsZFBlcm1pdCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgYnkgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LnBlcm1pdHRlZFBhcmFtcygpLiBJbmNsdWRlIHske3JlbGF0aW9uc2hpcE5hbWV9QXR0cmlidXRlczogWy4uLl19IGluIHRoZSByZXR1cm5lZCBwZXJtaXQuYClcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGV4dCA9IHRoaXMuX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe1xuICAgICAgICBjaGlsZFBlcm1pdCxcbiAgICAgICAgY29udHJvbGxlcixcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByYXdFbnRyaWVzOiBuZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lXG4gICAgICB9KVxuXG4gICAgICBpZiAoY29udGV4dC5yZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJlbnRMaW5rQXR0cmlidXRlcyA9IHRoaXMuX3BhcmVudExpbmtBdHRyaWJ1dGVzRm9yTmVzdGVkQ2hpbGQoe1xuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJlbGF0aW9uc2hpcDogY29udGV4dC5yZWxhdGlvbnNoaXAsXG4gICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgfSlcblxuICAgICAgY29uc3QgZGVzdHJveUVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgdXBkYXRlRW50cmllcyA9IFtdXG4gICAgICBjb25zdCBjcmVhdGVFbnRyaWVzID0gW11cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Py5fZGVzdHJveSkge1xuICAgICAgICAgIGlmICghY29udGV4dC5kZXN0cm95UGVybWl0dGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSByZXF1ZXN0ZWQgX2Rlc3Ryb3kgYnV0IFwiX2Rlc3Ryb3lcIiBpcyBub3QgaW4gdGhlIHBlcm1pdCBmb3IgdGhpcyByZWxhdGlvbnNoaXAuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFlbnRyeS5pZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBkZXN0cm95RW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9IGVsc2UgaWYgKGVudHJ5Py5pZCkge1xuICAgICAgICAgIHVwZGF0ZUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjcmVhdGVFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBkZXN0cm95RW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fZmluZFNjb3BlZENoaWxkKHtcbiAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIGlkLFxuICAgICAgICAgIHBhcmVudCxcbiAgICAgICAgICBwYXJlbnRMaW5rQXR0cmlidXRlcyxcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHVwZGF0ZUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSB1cGRhdGUgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgY2hpbGRQcmltYXJ5S2V5OiBjb250ZXh0LmNoaWxkUHJpbWFyeUtleSxcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBwYXJlbnQsXG4gICAgICAgICAgcGFyZW50TGlua0F0dHJpYnV0ZXMsXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQ6IGV4aXN0aW5nLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgZXhpc3Rpbmcuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjcmVhdGVFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgY2hpbGQuYXNzaWduKHBhcmVudExpbmtBdHRyaWJ1dGVzKVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFByaW1hcnlLZXk6IGNvbnRleHQuY2hpbGRQcmltYXJ5S2V5LFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBvbmUgbmVzdGVkIGVudHJ5J3MgYXR0cmlidXRlcyBhbmQgYXR0YWNobWVudHMgdG8gYSBjaGlsZCBtb2RlbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBc3NpZ25tZW50IGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5jaGlsZCAtIENoaWxkIG1vZGVsIHJlY2VpdmluZyBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzIC0gUGVybWl0dGVkIGNoaWxkIGF0dHJpYnV0ZSBhbmQgYXR0YWNobWVudCBuYW1lcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuZW50cnkgLSBOZXN0ZWQgZW50cnkgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtjaGlsZCwgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsIGVudHJ5fSkge1xuICAgIGlmIChlbnRyeS5hdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChlbnRyeS5hdHRyaWJ1dGVzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbmVzdGVkIGVudHJ5IGF0dHJpYnV0ZXMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuXG4gICAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoY2hpbGQsIGNoaWxkLmdldE1vZGVsQ2xhc3MoKSwgZW50cnkuYXR0cmlidXRlcywgdGhpcywgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMpXG4gICAgICBhd2FpdCB0aGlzLl9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMoY2hpbGQsIGZpbHRlcmVkKVxuICAgIH1cblxuICAgIGlmIChlbnRyeS5hdHRhY2htZW50cyAhPT0gdW5kZWZpbmVkICYmICFpc1BsYWluT2JqZWN0KGVudHJ5LmF0dGFjaG1lbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgbmVzdGVkIGVudHJ5IGF0dGFjaG1lbnRzIHRvIGJlIGFuIG9iamVjdC5cIilcbiAgICB9XG5cbiAgICB0aGlzLl9hc3NpZ25BdHRhY2htZW50cyhjaGlsZCwgZW50cnkuYXR0YWNobWVudHMgPz8gbnVsbCwgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMpXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBmb3JlaWduLWtleSBjb2x1bW4vbmFtZSB0byB0aGUgdGFyZ2V0IG1vZGVsJ3MgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgRksuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEZvcmVpZ24ta2V5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldIHx8IGZvcmVpZ25LZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBGSyBhdHRyaWJ1dGVzIHRoYXQgYmluZCBhIG5lc3RlZCBjaGlsZCB0byBpdHMgcGFyZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhcmVudC1saW5rIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gQXR0cmlidXRlcyB0aGF0IHNjb3BlIHRoZSBjaGlsZCB0byB0aGUgcGFyZW50LlxuICAgKi9cbiAgX3BhcmVudExpbmtBdHRyaWJ1dGVzRm9yTmVzdGVkQ2hpbGQoe3BhcmVudCwgcmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSB0aGlzLl9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge1tmb3JlaWduS2V5XTogc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocGFyZW50LmlkKCksIGBOZXN0ZWQgY2hpbGQgd3JpdGUgZm9yICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICBjb25zdCB0eXBlQXR0cmlidXRlID0gdGhpcy5fcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBhdHRyaWJ1dGVzW3R5cGVBdHRyaWJ1dGVdID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBwb2x5bW9ycGhpYyB0eXBlIGNvbHVtbi9uYW1lIHRvIGEgY2hpbGQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgdHlwZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBvbHltb3JwaGljIHR5cGUgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpY1R5cGVDb2x1bW4oKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3R5cGVDb2x1bW5dIHx8IHR5cGVDb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBhdXRob3JpemVkIG5lc3RlZCByZWNvcmQgYnkgaWQgd2l0aG91dCBwYXJlbnQgc2NvcGluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLmNoaWxkUHJpbWFyeUtleSAtIFJlc29sdmVkIGNoaWxkIHJlc291cmNlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gQ2hpbGQgaWQgZnJvbSB0aGUgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEF1dGhvcml6ZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZE5lc3RlZFJlY29yZCh7YWJpbGl0eSwgYWN0aW9uLCBjaGlsZFByaW1hcnlLZXksIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhjaGlsZFByaW1hcnlLZXksIGlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90ICR7YWN0aW9ufSBuZXN0ZWQgJHtyZWxhdGlvbnNoaXBOYW1lfVtpZD0ke2lkfV06IHJlY29yZCBub3QgZm91bmQgb3Igbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG5cbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWJpbGl0eSBhY3Rpb24gZm9yIGEgY2hpbGQgcmVzb3VyY2UgdXNpbmcgdGhlIGNoaWxkJ3Mgb3duXG4gICAqIGBhYmlsaXRpZXNgIG1hcHBpbmcg4oCUIG5ldmVyIHRoZSBwYXJlbnQgY29udHJvbGxlcidzLiBUaGlzIHByZXNlcnZlc1xuICAgKiBjdXN0b20gbWFwcGluZ3MgbGlrZSBge3VwZGF0ZTogXCJtYW5hZ2VcIn1gIGFuZCBjYXRjaGVzIHVubWFwcGVkIGFjdGlvbnNcbiAgICogaW5zdGVhZCBvZiBzaWxlbnRseSBkZWZhdWx0aW5nIHRvIHRoZSByYXcgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYmlsaXR5IGFjdGlvbiBmb3IgdGhlIGNoaWxkIHJlc291cmNlLlxuICAgKi9cbiAgX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uPy5hYmlsaXRpZXNcblxuICAgIGlmICghYWJpbGl0aWVzIHx8IHR5cGVvZiBhYmlsaXRpZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhbiAnYWJpbGl0aWVzJyBvYmplY3QgdG8gYXV0aG9yaXplIG5lc3RlZCAke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAoYWJpbGl0aWVzKVthY3Rpb25dXG5cbiAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhYmlsaXRpZXMuJHthY3Rpb259LmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBleGlzdGluZyBjaGlsZCBmb3IgYSBuZXN0ZWQgdXBkYXRlL2Rlc3Ryb3ksIHNjb3BlZCB0byB0aGVcbiAgICogY2hpbGQncyBvd24gbW9kZWwgY2xhc3MsIHRoZSBwYXJlbnQncyBmb3JlaWduIGtleSwgQU5EIHRoZSBjaGlsZFxuICAgKiByZXNvdXJjZSdzIGFiaWxpdHkgbWFwcGluZyBmb3IgdGhlIHJlcXVlc3RlZCBhY3Rpb24uIFRocm93cyB3aGVuIHRoZVxuICAgKiBjaGlsZCBkb2VzIG5vdCBleGlzdCwgZG9lcyBub3QgYmVsb25nIHRvIHRoZSBjdXJyZW50IHBhcmVudCwgb3IgaXNcbiAgICogbm90IGF1dGhvcml6ZWQg4oCUIGFsbCBvZiB3aGljaCBtdXN0IHJvbGwgdGhlIHRyYW5zYWN0aW9uIGJhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSBhcmdzLmNoaWxkUHJpbWFyeUtleSAtIFJlc29sdmVkIGNoaWxkIHJlc291cmNlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gQ2hpbGQgaWQgZnJvbSB0aGUgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5wYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gYXJncy5wYXJlbnRMaW5rQXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdGhhdCBzY29wZSB0aGUgY2hpbGQgdG8gdGhlIHBhcmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIChmb3IgZXJyb3IgbWVzc2FnZXMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBBdXRob3JpemVkLCBwYXJlbnQtbGlua2VkIGNoaWxkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgX2ZpbmRTY29wZWRDaGlsZCh7YWJpbGl0eSwgYWN0aW9uLCBjaGlsZFByaW1hcnlLZXksIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcGFyZW50LCBwYXJlbnRMaW5rQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBpZGVudGl0eUNvbmRpdGlvbnMgPSBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKGNoaWxkUHJpbWFyeUtleSwgaWQpXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCBwYXJlbnRWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGFyZW50TGlua0F0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGlkZW50aXR5Q29uZGl0aW9ucywgYXR0cmlidXRlTmFtZSkgJiYgaWRlbnRpdHlDb25kaXRpb25zW2F0dHJpYnV0ZU5hbWVdICE9PSBwYXJlbnRWYWx1ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiBpZGVudGl0eSBmaWVsZCAnJHthdHRyaWJ1dGVOYW1lfScgZG9lcyBub3QgbWF0Y2ggcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0uYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBsb29rdXAgPSB7Li4uaWRlbnRpdHlDb25kaXRpb25zLCAuLi5wYXJlbnRMaW5rQXR0cmlidXRlc31cbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShsb29rdXApXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kLCBkb2VzIG5vdCBiZWxvbmcgdG8gcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0sIG9yIGlzIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgYW4gYWxyZWFkeS1zYXZlZCBuZXN0ZWQgY2hpbGQgaXMgYXV0aG9yaXplZCB1bmRlciB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBvd24gYGNyZWF0ZWAgYWJpbGl0eS4gUm9sbHMgYmFjayB2aWEgdGhyb3duIGVycm9yIHdoZW4gbm90XG4gICAqIGF1dGhvcml6ZWQgc28gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGRlc3Ryb3lzIHRoZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCBpbnN0YW5jZSBqdXN0IGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gYXJncy5jaGlsZFByaW1hcnlLZXkgLSBSZXNvbHZlZCBjaGlsZCByZXNvdXJjZSBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIChmb3IgZXJyb3IgbWVzc2FnZXMpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2F1dGhvcml6ZUNyZWF0ZWRDaGlsZCh7YWJpbGl0eSwgY2hpbGQsIGNoaWxkUHJpbWFyeUtleSwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm5cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSB0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBcImNyZWF0ZVwiKVxuICAgIGNvbnN0IGlkZW50aXR5ID0gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKGNoaWxkUHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGNoaWxkLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gICAgY29uc3QgYXV0aG9yaXplZENoaWxkID0gYXdhaXQgdGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbiwgYWJpbGl0eSlcbiAgICAgIC5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhjaGlsZFByaW1hcnlLZXksIGlkZW50aXR5KSlcblxuICAgIGlmICghYXV0aG9yaXplZENoaWxkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjcmVhdGUgb24gJHtyZWxhdGlvbnNoaXBOYW1lfVske3RhcmdldE1vZGVsQ2xhc3MubmFtZX1dIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIG5lc3RlZCB3cml0ZXMsIHByZWxvYWQgZXZlcnkgcmVsYXRpb25zaGlwIGRlY2xhcmVkIGluIHRoZVxuICAgKiBwYXJlbnQncyBwZXJtaXQgc28gdGhlIHBvc3Qtc2F2ZSBzZXJpYWxpemUgc3RlcCBlbWl0cyB0aGVtIGFuZCB0aGVcbiAgICogY2xpZW50IGNhbiByZWNvbmNpbGUgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIFNhdmVkIHBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gcGVybWl0IC0gUGFyc2VkIHBhcmVudCBwZXJtaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3ByZWxvYWROZXN0ZWRXcml0YWJsZVJlbGF0aW9uc2hpcHMobW9kZWwsIHBlcm1pdCkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWVzID0gT2JqZWN0LmtleXMocGVybWl0Lm5lc3RlZClcblxuICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlbGF0aW9uc2hpcE5hbWVzKSB7XG4gICAgICBhd2FpdCBtb2RlbC5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUGFyc2VzIHRoZSBSYWlscy9hcGlfbWFrZXItc3R5bGUgZmxhdCBwZXJtaXQgc3BlYyByZXR1cm5lZCBmcm9tXG4gKiBgcGVybWl0dGVkUGFyYW1zKGFyZylgIGludG8gYSBzdHJ1Y3R1cmVkIHNoYXBlIHVzZWQgaW50ZXJuYWxseSBieSB0aGVcbiAqIHdyaXRlIHBpcGVsaW5lLiBTdHJpbmdzIGJlY29tZSBhdHRyaWJ1dGUgcGVybWl0czsgb2JqZWN0cyB3aG9zZSBrZXlzXG4gKiBlbmQgaW4gYEF0dHJpYnV0ZXNgIGJlY29tZSBuZXN0ZWQgcGVybWl0cyAodGhlIGtleSBwcmVmaXggbmFtZXMgdGhlXG4gKiByZWxhdGlvbnNoaXApLlxuICpcbiAqICAgcGFyc2VQZXJtaXR0ZWRQYXJhbXMoW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIixcbiAqICAgICB7dGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAqICAgXSlcbiAqICAgLy8g4oaSIHtcbiAqICAgLy8gICBhdHRyaWJ1dGVzOiBbXCJmaXJzdE5hbWVcIiwgXCJsYXN0TmFtZVwiXSxcbiAqICAgLy8gICBuZXN0ZWQ6IHtcbiAqICAgLy8gICAgIHRhc2tzOiB7YXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl0sIG5lc3RlZDoge319XG4gKiAgIC8vICAgfVxuICogICAvLyB9XG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCB1bmRlZmluZWR9IHBlcm1pdFNwZWMgLSBGbGF0IHBlcm1pdCBzcGVjLlxuICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCB7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59fSAtIFBhcnNlZCBzdHJ1Y3R1cmUuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUGVybWl0dGVkUGFyYW1zKHBlcm1pdFNwZWMpIHtcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICBjb25zdCBuZXN0ZWQgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShwZXJtaXRTcGVjKSkgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBwZXJtaXRTcGVjKSB7XG4gICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgYXR0cmlidXRlcy5wdXNoKGVudHJ5KVxuICAgIH0gZWxzZSBpZiAoZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IG5lc3RlZCByZWxhdGlvbnNoaXAga2V5cyBtdXN0IGVuZCBpbiBcIkF0dHJpYnV0ZXNcIiAoZ290IFwiJHtrZXl9XCIpLiBVc2UgXCIke2tleX1BdHRyaWJ1dGVzXCIgaW5zdGVhZC5gKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBrZXkuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcblxuICAgICAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBlbXB0eSByZWxhdGlvbnNoaXAgbmFtZSBpbiBrZXkgXCIke2tleX1cIi5gKVxuICAgICAgICB9XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5IGZvciBcIiR7a2V5fVwiOiBleHBlY3RlZCBhcnJheSBwZXJtaXQgc3BlYywgZ290ICR7dHlwZW9mIHZhbHVlfS5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModmFsdWUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IGV4cGVjdGVkIHN0cmluZyBvciBuZXN0ZWQtYXR0cmlidXRlcyBvYmplY3QsIGdvdCAke3R5cGVvZiBlbnRyeX0uYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2F0dHJpYnV0ZXMsIG5lc3RlZH1cbn1cblxuLyoqXG4gKiBMb2NhdGVzIHdoaWNoIHByb3RvdHlwZSBvd25zIGEgbWV0aG9kIGltcGxlbWVudGF0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGluc3RhbmNlIC0gSW5zdGFuY2UgcmVjZWl2aW5nIHRoZSBtZXRob2QuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICogQHJldHVybnMge29iamVjdCB8IG51bGx9IC0gUHJvdG90eXBlIHRoYXQgb3ducyB0aGUgbWV0aG9kLlxuICovXG5mdW5jdGlvbiBwcm90b3R5cGVPd25lckZvck1ldGhvZChpbnN0YW5jZSwgbWV0aG9kTmFtZSkge1xuICBsZXQgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGluc3RhbmNlKVxuXG4gIHdoaWxlIChwcm90b3R5cGUpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHByb3RvdHlwZSwgbWV0aG9kTmFtZSkpIHJldHVybiBwcm90b3R5cGVcblxuICAgIHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90b3R5cGUpXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgZmlsdGVyIHdyaXRhYmxlIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFJlc291cmNlTW9kZWxDbGFzc1xuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVjZWl2ZXIgLSBNb2RlbCBpbnN0YW5jZSBvciBwcm90b3R5cGUuXG4gKiBAcGFyYW0ge1dyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc30gcmVjZWl2ZXJDbGFzcyAtIFN0YXRpYyBoZWxwZXIgb3duZXIgZm9yIHRoZSByZWNlaXZlci5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxSZXNvdXJjZU1vZGVsQ2xhc3MsIFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9IFtyZXNvdXJjZV0gLSBSZXNvdXJjZSBpbnN0YW5jZSBmb3IgdmlydHVhbC1zZXR0ZXIgZGV0ZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IG51bGx9IFtwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lc10gLSBPcHRpb25hbCBleHBsaWNpdCBwZXJtaXQgbGlzdC4gYG51bGxgIGZhbGxzIGJhY2sgdG8gc2V0dGVyLWV4aXN0ZW5jZSBjaGVja3Mgb25seS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV3JpdGFibGUgYXR0cmlidXRlcyBvbmx5LlxuICovXG5mdW5jdGlvbiBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKFxuICByZWNlaXZlcixcbiAgcmVjZWl2ZXJDbGFzcyxcbiAgYXR0cmlidXRlcyxcbiAgcmVzb3VyY2UgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8UmVzb3VyY2VNb2RlbENsYXNzLCBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsfSAqLyAobnVsbCksXG4gIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzID0gbnVsbFxuKSB7XG4gIC8vIEZyb250ZW5kLW1vZGVsIHdyaXRlcyBzaG91bGQgZmFpbCBmYXN0IHdoZW4gY2FsbGVycyBzdWJtaXQgcmVhZC1vbmx5IG9yIHVua25vd24gYXR0cnMuXG4gIC8vIFNpbGVudCBkcm9wcyBoaWRlIGNvbnRyYWN0IG1pc3Rha2VzIGluIGdlbmVyYXRlZCBtb2RlbHMgYW5kIGFwcC1zaWRlIHdyYXBwZXIgY29kZS5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHdyaXRhYmxlQXR0cmlidXRlcyA9IHt9XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3Qgbm90UGVybWl0dGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgY29uc3QgcGVybWl0U2V0ID0gQXJyYXkuaXNBcnJheShwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgPyBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSA6IG51bGxcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgbGV0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gW11cblxuICBpZiAocmVzb3VyY2UpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHJlc291cmNlLmNvbnN0cnVjdG9yKVxuXG4gICAgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSBSZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW11cbiAgfVxuXG4gIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KHRyYW5zbGF0ZWRBdHRyaWJ1dGVzKVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgIGlmIChwZXJtaXRTZXQgJiYgIXBlcm1pdFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSByZWNlaXZlckNsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHx8IGF0dHJpYnV0ZU5hbWVcbiAgICBjb25zdCByZXF1ZXN0ZWRTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpfWBcbiAgICBjb25zdCBzZXR0ZXJOYW1lID0gcmVjZWl2ZXJDbGFzcy5maW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlKHJlY2VpdmVyLCByZXF1ZXN0ZWRTZXR0ZXJOYW1lKSB8fCByZXF1ZXN0ZWRTZXR0ZXJOYW1lXG4gICAgY29uc3QgcmVzb3VyY2VTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX1BdHRyaWJ1dGVgXG4gICAgY29uc3QgcmVzb3VyY2VTZXR0ZXIgPSByZXNvdXJjZT8ucmVzb3VyY2VNZXRob2QocmVzb3VyY2VTZXR0ZXJOYW1lKVxuXG4gICAgaWYgKHNldHRlck5hbWUgaW4gcmVjZWl2ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmIChyZXNvdXJjZVNldHRlcikge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBpbnZhbGlkQXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICB9XG5cbiAgaWYgKG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gIH1cblxuICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgd3JpdGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgcmV0dXJuIHdyaXRhYmxlQXR0cmlidXRlc1xufVxuIl19