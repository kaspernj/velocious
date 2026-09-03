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
     * @returns {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} - Authorized query.
     */
    authorizedQuery(action) {
        // Narrows the controller query to this resource's model class.
        return /** @type {import("../database/query/model-class-query.js").default<TDatabaseModelClass>} */ (this.typedControllerInstance().frontendModelAbilityAuthorizedQuery(action));
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
     * @returns {{ability: import("../authorization/ability.js").default | undefined, childResource: FrontendModelBaseResource, childResourceConfig: FrontendModelResolvedResourceConfiguration, childWritableAttributes: string[], destroyPermitted: boolean, entries: Array<FrontendModelResourceNestedEntry>, relationship: import("../database/record/relationships/base.js").default, targetModelClass: typeof import("../database/record/index.js").default}} Nested relationship context.
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
        const childWritableAttributes = childPermit.attributes.filter((name) => name !== "_destroy");
        const entries = rawNormalizedEntries
            .map((entry) => this._normalizeNestedRelationshipEntry({ childPermit, childResourceConfiguration: childResourceConfig.resourceConfiguration, entry, relationshipName, targetModelClass }))
            .filter((entry) => {
            if (typeof modelAcceptance.rejectIf !== "function")
                return true;
            return !modelAcceptance.rejectIf(isPlainObject(entry.attributes) ? entry.attributes : {});
        });
        return {
            ability: controller.currentAbility() || this.ability,
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
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {FrontendModelResourceNestedEntry} args.entry - Raw nested entry.
     * @param {string} args.relationshipName - Relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {FrontendModelResourceNestedEntry} Normalized nested entry.
     */
    _normalizeNestedRelationshipEntry({ childPermit, childResourceConfiguration, entry, relationshipName, targetModelClass }) {
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
                const primaryKey = childResourceConfiguration.primaryKey || targetModelClass.primaryKey();
                modelPrimaryKeyConditions(primaryKey, value);
                normalized.id = /** @type {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} */ (value);
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
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Child id from the payload.
     * @param {string} args.relationshipName - Parent's relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} Authorized child model.
     */
    async _findNestedRecord({ ability, action, childResourceConfiguration, id, relationshipName, targetModelClass }) {
        const primaryKey = childResourceConfiguration.primaryKey || targetModelClass.primaryKey();
        const query = ability
            ? targetModelClass.accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
            : targetModelClass.where({});
        const existing = await query.findBy(modelPrimaryKeyConditions(primaryKey, id));
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
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {import("../utils/model-primary-key.js").ModelPrimaryKeyValue} args.id - Child id from the payload.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {Record<string, string | number>} args.parentLinkAttributes - Attributes that scope the child to the parent.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} - Authorized, parent-linked child model.
     */
    async _findScopedChild({ ability, action, childResourceConfiguration, id, parent, parentLinkAttributes, relationshipName, targetModelClass }) {
        const primaryKey = childResourceConfiguration.primaryKey || targetModelClass.primaryKey();
        const lookup = { ...modelPrimaryKeyConditions(primaryKey, id), ...parentLinkAttributes };
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
     * @param {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration} args.childResourceConfiguration - Child resource configuration.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<void>}
     */
    async _authorizeCreatedChild({ ability, child, childResourceConfiguration, relationshipName, targetModelClass }) {
        if (!ability)
            return;
        const abilityAction = this._resolveChildAbilityAction(childResourceConfiguration, "create");
        const primaryKey = childResourceConfiguration.primaryKey || targetModelClass.primaryKey();
        const identity = readModelPrimaryKeyValue(primaryKey, (attributeName) => child.readAttribute(attributeName));
        const authorizedChild = await targetModelClass
            .accessibleFor(abilityAction, ability)
            .findBy(modelPrimaryKeyConditions(primaryKey, identity));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sRUFBQyx5QkFBeUIsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQzdILE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7Ozs7R0FTRztBQUVIOzs7Ozs7Ozs7Ozs7R0FZRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7OztHQUtHO0FBRUg7OztHQUdHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSx3Q0FBd0MsQ0FBQyxhQUFhO0lBQ3BFLE9BQU8sbUtBQW1LLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFBO0FBQ3JOLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBMEIsU0FBUSx5QkFBeUI7SUFDOUUsMERBQTBEO0lBQzFELE1BQU0sQ0FBQyxVQUFVLEdB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LElBQUksRUFBRSxnQ0FBZ0MsRUFBQyxDQUFDLENBQUE7SUFDakosQ0FBQztJQUVELE9BQU8sa0JBQWtCLENBQUE7QUFDM0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSBmcm9tIFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4uL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge21vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5cbi8qKlxuICogQmFja2VuZCBvciBmcm9udGVuZCBtb2RlbCBjbGFzcyBib3VuZCB0byBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiKS5BdXRob3JpemF0aW9uUmVzb3VyY2VNb2RlbENsYXNzICYge2F0dGFjaG1lbnREZWZpbml0aW9uczogKCkgPT4gUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+LCBwcmltYXJ5S2V5OiAoKSA9PiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufX0gRnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc1xuICovXG5cbi8qKlxuICogQnVpbHQtaW4gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYWN0aW9uLlxuICogQHR5cGVkZWYge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb25cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgbWV0aG9kcyB1c2VkIGJ5IHJlc291cmNlcy5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHQgJiB7XG4gKiAgIGN1cnJlbnRBYmlsaXR5OiAoKSA9PiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCxcbiAqICAgYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbjogKGFyZ3M6IHtwYWdpbmF0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9uLCBxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSkgPT4gdm9pZCxcbiAqICAgYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoOiAoYXJnczoge3F1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sIHNlYXJjaDogRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSkgPT4gdm9pZCxcbiAqICAgYXBwbHlGcm9udGVuZE1vZGVsU29ydDogKGFyZ3M6IHtxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LCBzb3J0OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0fSkgPT4gdm9pZCxcbiAqICAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBY3Rpb246IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbikgPT4gc3RyaW5nLFxuICogICBmcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeTogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnk6IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbikgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsSW5kZXhRdWVyeTogKG9wdGlvbnM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9ucyAmIHtyZXNvdXJjZT86IFBpY2s8RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzPiwgXCJhcHBseUZyb250ZW5kTW9kZWxJbmRleFBhZ2luYXRpb25cIiB8IFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTZWFyY2hcIiB8IFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTb3J0XCI+fSkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsUGFyYW1zOiAoKSA9PiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtcyxcbiAqICAgZnJvbnRlbmRNb2RlbFByZWxvYWQ6ICgpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsLFxuICogICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzczogKG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCkgPT4gRnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgbnVsbCxcbiAqICAgc2VyaWFsaXplRnJvbnRlbmRNb2RlbDogKG1vZGVsOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBvYmplY3QgfCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbD4+XG4gKiB9fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyXG4gKi9cblxuLyoqXG4gKiBHZW5lcmljIGZyb250ZW5kLW1vZGVsIGluZGV4IHF1ZXJ5IHBhc3NlZCB0byByZXNvdXJjZSBxdWVyeSBob29rcy5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5XG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIGZvciBidWlsZGluZyBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGluZGV4IHF1ZXJ5LlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2luY2x1ZGVQYWdpbmF0aW9uXSAtIFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgcGFnaW5hdGlvbiBwYXJhbXMgc2hvdWxkIGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlU29ydF0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHNvcnQgcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvblxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBsaW1pdCAtIE1heGltdW0gbnVtYmVyIG9mIHJlY29yZHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG9mZnNldCAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHBhZ2UgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwZXJQYWdlIC0gUGFnZSBzaXplLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2hcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gKiBAcHJvcGVydHkge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzb3J0IGJ5LlxuICogQHByb3BlcnR5IHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzIHR5cGUuXG4gKiBAdGVtcGxhdGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gW1REYXRhYmFzZU1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3NcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gY29udHJvbGxlciAtIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gKiBAcHJvcGVydHkge1REYXRhYmFzZU1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uIChvciByYXcgaW5wdXQgc2hhcGUgZHVyaW5nIGVhcmx5IGJvb3RzdHJhcCkuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJncyB0eXBlLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBbVE1vZGVsQ2xhc3M9RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc11cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYWJpbGl0eV0gLSBBYmlsaXR5IGluc3RhbmNlIHdoZW4gdGhlIHJlc291cmNlIGlzIHVzZWQgZGlyZWN0bHkgZm9yIGF1dGhvcml6YXRpb24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2NvbmZpZ3VyYXRpb25dIC0gVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24gZm9yIGNvbnRyb2xsZXItbGVzcyBjb25zdHJ1Y3Rpb24gKGZvciBleGFtcGxlIHRoZSBzeW5jIHdlYnNvY2tldCBjaGFubmVsKTsgdGhlIGNvbnRyb2xsZXIgcGF0aCBkZXJpdmVzIGl0IGZyb20gdGhlIGNvbnRyb2xsZXIgaW5zdGVhZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2NvbnRleHRdIC0gQWJpbGl0eSBjb250ZXh0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSBbbG9jYWxzXSAtIEFiaWxpdHkgbG9jYWxzLlxuICogQHByb3BlcnR5IHtUTW9kZWxDbGFzc30gW21vZGVsQ2xhc3NdIC0gT3B0aW9uYWwgYmFja2luZyBtb2RlbCBjbGFzcyBvdmVycmlkZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbW9kZWxOYW1lXSAtIE9wdGlvbmFsIG1vZGVsIG5hbWUgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSBbcGFyYW1zXSAtIE9wdGlvbmFsIHBhcmFtcyBvdmVycmlkZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gW3Jlc291cmNlQ29uZmlndXJhdGlvbl0gLSBPcHRpb25hbCBub3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cblxuLyoqXG4gKiBJbnRlcm5hbCBjb25zdHJ1Y3RvciBjb250cmFjdCB1c2VkIHdoZW4gYSByZXNvdXJjZSBpbnN0YW50aWF0ZXMgaXRzIHNoYXJlZFxuICogY291bnRlcnBhcnQgYWNyb3NzIHRoZSBmcm9udGVuZC9iYWNrZW5kIG1vZGVsIGJvdW5kYXJ5LlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBUTW9kZWxDbGFzc1xuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFREYXRhYmFzZU1vZGVsQ2xhc3NcbiAqIEB0eXBlZGVmIHt7bmV3IChhcmdzOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnczxGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzPiB8IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzKTogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yXG4gKi9cblxuLyoqXG4gKiBOb3JtYWxpemVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIHBhc3NlZCB0byB0aGUgcmVzb3VyY2Ugc3luYyBob29rcy5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9zeW5jL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBGcm9udGVuZE1vZGVsU3luY011dGF0aW9uXG4gKi9cblxuLyoqXG4gKiBTeW5jIG11dGF0aW9uIGF1dGhvcml6YXRpb24gcmVzdWx0LlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGFsbG93ZWQgLSBXaGV0aGVyIHRoZSBtdXRhdGlvbiBtYXkgYmUgYXBwbGllZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbcmVhc29uXSAtIFN0YWJsZSBmYWlsdXJlIHJlYXNvbiBjb2RlIHdoZW4gZGVuaWVkLlxuICovXG5cbi8qKlxuICogQXJndW1lbnRzIGZvciB0aGUgYXBwbHlTeW5jIGZ1bGwtZXNjYXBlLWhhdGNoIGhvb2suXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsQXBwbHlTeW5jQXJnc1xuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBleGlzdGluZ1N5bmMgLSBFeGlzdGluZyBzeW5jIHJvdyBvciBudWxsLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBtdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICovXG5cbi8qKlxuICogQXBwbHkgcmVzdWx0IHByb2R1Y2VkIGJ5IHJvdXRlZCBzeW5jIG11dGF0aW9uIGFwcGxpY2F0aW9uLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSBjcmVhdGVkIC0gV2hldGhlciBhIHJlY29yZCB3YXMgY3JlYXRlZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RlbGV0ZWRdIC0gV2hldGhlciBhIHJlY29yZCB3YXMgZGVsZXRlZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSByZWNvcmQgLSBBcHBsaWVkIHJlY29yZCBvciBudWxsLlxuICovXG5cbi8qKlxuICogUmVzb2x2ZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcmVnaXN0cmF0aW9uLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VDb25maWd1cmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBiYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBvd25pbmcgdGhlIHJlc291cmNlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIEZyb250ZW5kIG1vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSByZXNvdXJjZUNsYXNzIC0gUmVzb3VyY2UgY2xhc3MuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuXG4vKipcbiAqIFRyYW5zcG9ydC1zYWZlIHZhbHVlIGFjY2VwdGVkIGluIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIG11dGF0aW9uIHBheWxvYWRzLlxuICogTmVzdGVkIG9iamVjdC9hcnJheSB2YWx1ZXMgYXJlIGludGVudGlvbmFsbHkgb3BhcXVlIGJlY2F1c2UgVHlwZVNjcmlwdCByZWplY3RzXG4gKiByZWN1cnNpdmUgSlNEb2MgdHlwZWRlZnMgZm9yIHRoaXMgdHJhbnNwb3J0IHBheWxvYWQgY29udHJhY3QuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL2Jhc2UuanNcIikuRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlIHwgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IEFycmF5PHVua25vd24+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWVcbiAqL1xuXG4vKipcbiAqIEF0dHJpYnV0ZSBwYXlsb2FkIGFjY2VwdGVkIGJ5IGZyb250ZW5kLW1vZGVsIHJlc291cmNlIG11dGF0aW9ucy5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWU+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkXG4gKi9cblxuLyoqXG4gKiBWaXJ0dWFsIHNldHRlciBtZXRob2Qgb24gYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZS5cbiAqIEB0eXBlZGVmIHsoYXJnMTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIGFyZzI6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZSkgPT4gKHZvaWQgfCBQcm9taXNlPHZvaWQ+KX0gRnJvbnRlbmRNb2RlbFJlc291cmNlVmlydHVhbFNldHRlclxuICovXG5cbi8qKlxuICogU3RhdGljIGhlbHBlcnMgdXNlZCB3aGVuIGNoZWNraW5nIHdoZXRoZXIgYSBtb2RlbC1saWtlIHJlY2VpdmVyIGFjY2VwdHMgYW4gYXR0cmlidXRlLlxuICogQHR5cGVkZWYge29iamVjdH0gV3JpdGFibGVBdHRyaWJ1dGVSZWNlaXZlckNsYXNzXG4gKiBAcHJvcGVydHkgeyhhcmc6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbH0gcmVzb2x2ZUF0dHJpYnV0ZU5hbWUgLSBSZXNvbHZlcyBhbGlhc2VzIHRvIGNhbm9uaWNhbCBhdHRyaWJ1dGUgbmFtZXMuXG4gKiBAcHJvcGVydHkgeyhhcmcxOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGFyZzI6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbH0gZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZSAtIExvY2F0ZXMgYSBzZXR0ZXIgbWV0aG9kIG9uIHRoZSByZWNlaXZlci5cbiAqL1xuXG4vKipcbiAqIE9wdGlvbnMgcGFzc2VkIHdoaWxlIHNhdmluZyBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbnMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc1xuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkIHwgbnVsbH0gW2F0dGFjaG1lbnRzXSAtIFVwbG9hZGVkIGF0dGFjaG1lbnQgYXR0cmlidXRlcy5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGx9IFtjb250cm9sbGVyXSAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIG11dGF0aW9uLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkIHwgbnVsbH0gW25lc3RlZEF0dHJpYnV0ZXNdIC0gTmVzdGVkIGF0dHJpYnV0ZXMgcGF5bG9hZC5cbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZW50cnkuXG4gKiBAdHlwZWRlZiB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCAmIHtpZD86IGltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlLCBfZGVzdHJveT86IGJvb2xlYW4sIGF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBhdHRhY2htZW50cz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQsIG5lc3RlZEF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnlcbiAqL1xuXG4vKipcbiAqIE5hcnJvd3MgYW4gdW5ib3VuZCByZXNvdXJjZSByZWdpc3RyeSBlbnRyeSBhdCBmcmFtZXdvcmstb3duZWQgY29uc3RydWN0aW9uXG4gKiBzaXRlcyB3aGVyZSB0aGUgYmFja2luZyBkYXRhYmFzZSBtb2RlbCBoYXMgYWxyZWFkeSBiZWVuIHJlc29sdmVkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gUmVzb3VyY2VDbGFzcyAtIFVuYm91bmQgcmVzb3VyY2UgY2xhc3MuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3Rvcjx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IFJ1bnRpbWUgY29uc3RydWN0b3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yKFJlc291cmNlQ2xhc3MpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3Rvcjx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChSZXNvdXJjZUNsYXNzKSlcbn1cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBiYWNrZW5kIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gW1RNb2RlbENsYXNzPXR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbVERhdGFiYXNlTW9kZWxDbGFzcz1FeHRyYWN0PFRNb2RlbENsYXNzLCB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGV4dGVuZHMgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSB7XG4gIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIE1vZGVsQ2xhc3MgPSB1bmRlZmluZWRcblxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYWJpbGl0aWVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYXR0YWNobWVudHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBjb2xsZWN0aW9uQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1lbWJlckNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHJlbGF0aW9uc2hpcHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtb2RlbE5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHByaW1hcnlLZXkgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlcnZlckNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBzZXJ2ZXIgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgYm9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHN5bmMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gIHN0YXRpYyBTaGFyZWRSZXNvdXJjZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEZWNsYXJhdGl2ZSB3cml0YWJsZS1hdHRyaWJ1dGUgcGVybWl0IGxpc3QgKGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZXMpXG4gICAqIHVzZWQgYXMgdGhlIGRlZmF1bHQge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UjcGVybWl0dGVkUGFyYW1zfSBhbmRcbiAgICogYXMgdGhlIHJvdXRlZCBzeW5jIHJlcGxheSBwZXJtaXQuIFJlc29sdmVkIHRocm91Z2ggdGhlIHNoYXJlZCByZXNvdXJjZVxuICAgKiBsaWtlIHRoZSBvdGhlciBzdGF0aWMgcmVzb3VyY2UgY29uZmlnOiBhbiB1bmRlY2xhcmVkIGVudmlyb25tZW50IGxpc3RcbiAgICogZmFsbHMgYmFjayB0byB0aGUgc2hhcmVkIHJlc291cmNlJ3MgbGlzdCwgd2hpbGUgYW4gZXhwbGljaXQgZGVjbGFyYXRpb25cbiAgICogKGluY2x1ZGluZyBgbnVsbGApIHdpbnMuXG4gICAqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyB3cml0YWJsZUF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnczxUTW9kZWxDbGFzcz4gfCBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJnczxURGF0YWJhc2VNb2RlbENsYXNzPn0gYXJncyAtIFJlc291cmNlIGFyZ3MuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzKSB7XG4gICAgc3VwZXIoe1xuICAgICAgYWJpbGl0eTogXCJhYmlsaXR5XCIgaW4gYXJncyA/IGFyZ3MuYWJpbGl0eSA6IHVuZGVmaW5lZCxcbiAgICAgIGNvbnRleHQ6IFwiY29udGV4dFwiIGluIGFyZ3MgPyBhcmdzLmNvbnRleHQgfHwge30gOiB7fSxcbiAgICAgIGxvY2FsczogXCJsb2NhbHNcIiBpbiBhcmdzID8gYXJncy5sb2NhbHMgfHwge30gOiB7fVxuICAgIH0pXG5cbiAgICAvLyBOYXJyb3dzIHRoZSBzdWJjbGFzcyBzdGF0aWMgc2lkZSB0byB0aGUgbW9kZWwgY2xhc3MgY2FycmllZCBieSB0aGlzIHJlc291cmNlIGdlbmVyaWMuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgJiB7TW9kZWxDbGFzczogVE1vZGVsQ2xhc3MgfCB1bmRlZmluZWQsIG1vZGVsQ2xhc3M6ICgpID0+IFRNb2RlbENsYXNzfX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgZGVmYXVsdFJlc291cmNlQ29uZmlndXJhdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqLyAoe2F0dHJpYnV0ZXM6IFtdfSlcblxuICAgIHRoaXMuY29udHJvbGxlciA9IFwiY29udHJvbGxlclwiIGluIGFyZ3MgPyBhcmdzLmNvbnRyb2xsZXIgOiB1bmRlZmluZWRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZSA9IFwiY29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLmNvbmZpZ3VyYXRpb24gOiB1bmRlZmluZWRcbiAgICAvLyBOYXJyb3dzIHRoZSBpbnRlcm5hbCBjb250cm9sbGVyL3NoYXJlZC1yZXNvdXJjZSBjb25zdHJ1Y3Rpb24gcGF0aCB0byB0aGUgcmVzb3VyY2UncyBkZWNsYXJlZCBtb2RlbCBnZW5lcmljLlxuICAgIHRoaXMubW9kZWxDbGFzc1ZhbHVlID0gLyoqIEB0eXBlIHtUTW9kZWxDbGFzc30gKi8gKFwibW9kZWxDbGFzc1wiIGluIGFyZ3MgPyBhcmdzLm1vZGVsQ2xhc3MgOiBSZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKSlcbiAgICB0aGlzLm1vZGVsTmFtZVZhbHVlID0gXCJtb2RlbE5hbWVcIiBpbiBhcmdzID8gYXJncy5tb2RlbE5hbWUgOiB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIHRoaXMucGFyYW1zVmFsdWUgPSBcInBhcmFtc1wiIGluIGFyZ3MgPyBhcmdzLnBhcmFtcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUgPSBcInJlc291cmNlQ29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLnJlc291cmNlQ29uZmlndXJhdGlvbiA6IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbmZpZ3VyZWQgc2hhcmVkIHJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gU2hhcmVkIHJlc291cmNlIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHNoYXJlZFJlc291cmNlQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuU2hhcmVkUmVzb3VyY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIHN0YXRpYyByZXNvdXJjZSBjb25maWcgdmFsdWUgZnJvbSB0aGUgZW52aXJvbm1lbnQgcmVzb3VyY2UgZmlyc3QsXG4gICAqIHRoZW4gZnJvbSB0aGUgc2hhcmVkIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge1wiYWJpbGl0aWVzXCIgfCBcImF0dGFjaG1lbnRzXCIgfCBcImF0dHJpYnV0ZXNcIiB8IFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiIHwgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIiB8IFwiY29sbGVjdGlvbkNvbW1hbmRzXCIgfCBcImNvbW1hbmRzXCIgfCBcIm1lbWJlckNvbW1hbmRzXCIgfCBcIm1vZGVsTmFtZVwiIHwgXCJwcmltYXJ5S2V5XCIgfCBcInJlbGF0aW9uc2hpcHNcIiB8IFwic2VydmVyXCIgfCBcInN5bmNcIiB8IFwidHJhbnNsYXRlZEF0dHJpYnV0ZXNcIiB8IFwid3JpdGFibGVBdHRyaWJ1dGVzXCJ9IG5hbWUgLSBTdGF0aWMgY29uZmlnIHByb3BlcnR5IG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBSZXNvbHZlZCBjb25maWcgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShuYW1lKSB7XG4gICAgaWYgKHRoaXNbbmFtZV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXNbbmFtZV1cblxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VDbGFzcygpKVxuXG4gICAgaWYgKCFTaGFyZWRSZXNvdXJjZSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmIChTaGFyZWRSZXNvdXJjZVtuYW1lXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gU2hhcmVkUmVzb3VyY2VbbmFtZV1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0cmFuc2xhdGVkIGF0dHJpYnV0ZXMgZnJvbSBlbnZpcm9ubWVudCBhbmQgc2hhcmVkIHJlc291cmNlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAtIFRyYW5zbGF0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwidHJhbnNsYXRlZEF0dHJpYnV0ZXNcIikpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZnJvbnRlbmQtc2FmZSBhdHRhY2htZW50IGRlY2xhcmF0aW9ucyBmcm9tIHRoZSBiYWNraW5nIG1vZGVsLlxuICAgKiBSZXNvdXJjZS1sZXZlbCBkZWNsYXJhdGlvbnMgcmVtYWluIGFzIGEgZmFsbGJhY2sgZm9yIGZyb250ZW5kLW9ubHkgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+fSAtIENsaWVudCBhdHRhY2htZW50IGNvbmZpZ3VyYXRpb24ga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50Q29uZmlndXJhdGlvbnMoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZEF0dGFjaG1lbnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhdHRhY2htZW50c1wiKSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGNvbmZpZ3VyZWRBdHRhY2htZW50cyA/IHsuLi5jb25maWd1cmVkQXR0YWNobWVudHN9IDoge31cblxuICAgIGlmICghdGhpcy5Nb2RlbENsYXNzKSByZXR1cm4gYXR0YWNobWVudHNcblxuICAgIGZvciAoY29uc3QgW2F0dGFjaG1lbnROYW1lLCBkZWZpbml0aW9uXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLk1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKCkpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50Q29uZmlnID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbn0gKi8gKHt0eXBlOiBkZWZpbml0aW9uLnR5cGV9KVxuXG4gICAgICBpZiAoZGVmaW5pdGlvbi5zeW5jKSBhdHRhY2htZW50Q29uZmlnLnN5bmMgPSB7Li4uZGVmaW5pdGlvbi5zeW5jfVxuXG4gICAgICBhdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBhdHRhY2htZW50Q29uZmlnXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRzXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmVzb3VyY2UgaW5zdGFuY2UgZm9yIHNoYXJlZC1yZXNvdXJjZSBmYWxsYmFjayBjYWxscy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbH0gLSBTaGFyZWQgcmVzb3VyY2UgaW5zdGFuY2Ugd2hlbiBjb25maWd1cmVkLlxuICAgKi9cbiAgc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpIHtcbiAgICBpZiAodGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG5cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz4gfCB1bmRlZmluZWR9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlQ2xhc3MoKSlcblxuICAgIGlmICghU2hhcmVkUmVzb3VyY2UpIHtcbiAgICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gbnVsbFxuICAgICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG4gICAgfVxuXG4gICAgaWYgKFNoYXJlZFJlc291cmNlID09PSBSZXNvdXJjZUNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7UmVzb3VyY2VDbGFzcy5uYW1lfS5TaGFyZWRSZXNvdXJjZSBjYW5ub3QgcG9pbnQgdG8gaXRzZWxmLmApXG4gICAgfVxuXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2VDb25zdHJ1Y3RvciA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcjxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChTaGFyZWRSZXNvdXJjZSkpXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSBuZXcgU2hhcmVkUmVzb3VyY2VDb25zdHJ1Y3Rvcih7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyOiB0aGlzLmNvbnRyb2xsZXIsXG4gICAgICBjb250ZXh0OiB0aGlzLmNvbnRleHQsXG4gICAgICBsb2NhbHM6IHRoaXMubG9jYWxzLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IHRoaXMubW9kZWxOYW1lKCksXG4gICAgICBwYXJhbXM6IHRoaXMucGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKClcbiAgICB9KVxuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gc2hhcmVkUmVzb3VyY2VcblxuICAgIHJldHVybiBzaGFyZWRSZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxzIGEgc2hhcmVkLXJlc291cmNlIG1ldGhvZCBvbmx5IHdoZW4gdGhlIHNoYXJlZCByZXNvdXJjZSBvdmVycmlkZXMgdGhlIGZyYW1ld29yayBkZWZhdWx0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7dW5rbm93bltdfSBhcmdzIC0gTWV0aG9kIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt7Y2FsbGVkOiBib29sZWFuLCByZXN1bHQ6IHVua25vd259fSAtIFNoYXJlZCBtZXRob2QgY2FsbCByZXN1bHQuXG4gICAqL1xuICBjYWxsU2hhcmVkUmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSwgYXJncykge1xuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlKClcblxuICAgIGlmICghc2hhcmVkUmVzb3VyY2UpIHJldHVybiB7Y2FsbGVkOiBmYWxzZSwgcmVzdWx0OiB1bmRlZmluZWR9XG5cbiAgICBjb25zdCBtZXRob2RPd25lciA9IHByb3RvdHlwZU93bmVyRm9yTWV0aG9kKHNoYXJlZFJlc291cmNlLCBtZXRob2ROYW1lKVxuXG4gICAgaWYgKCFtZXRob2RPd25lciB8fCBtZXRob2RPd25lciA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUgfHwgbWV0aG9kT3duZXIgPT09IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UucHJvdG90eXBlKSB7XG4gICAgICByZXR1cm4ge2NhbGxlZDogZmFsc2UsIHJlc3VsdDogdW5kZWZpbmVkfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzaGFyZWRSZXNvdXJjZSkpW21ldGhvZE5hbWVdXG5cbiAgICByZXR1cm4ge2NhbGxlZDogdHJ1ZSwgcmVzdWx0OiBtZXRob2QuYXBwbHkoc2hhcmVkUmVzb3VyY2UsIGFyZ3MpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hhcmVkIG1ldGhvZCByZXN1bHQgb3IgYSBmYWxsYmFjayBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIFNoYXJlZCBtZXRob2QgbmFtZS5cbiAgICogQHBhcmFtIHt1bmtub3duW119IGFyZ3MgLSBTaGFyZWQgbWV0aG9kIGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUmVzdWx0fSBmYWxsYmFjayAtIEZhbGxiYWNrIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UmVzdWx0fSAtIFNoYXJlZCBvciBmYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBzaGFyZWRSZXNvdXJjZU1ldGhvZE9yKG1ldGhvZE5hbWUsIGFyZ3MsIGZhbGxiYWNrKSB7XG4gICAgY29uc3Qgc2hhcmVkUmVzdWx0ID0gdGhpcy5jYWxsU2hhcmVkUmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSwgYXJncylcblxuICAgIGlmIChzaGFyZWRSZXN1bHQuY2FsbGVkKSByZXR1cm4gLyoqIEB0eXBlIHtSZXN1bHR9ICovIChzaGFyZWRSZXN1bHQucmVzdWx0KVxuXG4gICAgcmV0dXJuIGZhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIG1ldGhvZCBvbiB0aGlzIHJlc291cmNlIG9yIGl0cyBzaGFyZWQgZmFsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7bWV0aG9kOiAoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3duLCByZXNvdXJjZTogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59IHwgbnVsbH0gLSBSZXNvbHZlZCBtZXRob2QgYW5kIHJlY2VpdmVyLlxuICAgKi9cbiAgcmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSkge1xuICAgIGNvbnN0IG93bk1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKSlbbWV0aG9kTmFtZV1cblxuICAgIGlmICh0eXBlb2Ygb3duTWV0aG9kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAob3duTWV0aG9kKSxcbiAgICAgICAgcmVzb3VyY2U6IHRoaXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoIXNoYXJlZFJlc291cmNlKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc2hhcmVkTWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIGlmICh0eXBlb2Ygc2hhcmVkTWV0aG9kICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWV0aG9kOiAvKiogQHR5cGUgeyguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd259ICovIChzaGFyZWRNZXRob2QpLFxuICAgICAgcmVzb3VyY2U6IHNoYXJlZFJlc291cmNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0aWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhYmlsaXRpZXMoKSB7XG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWJpbGl0aWVzXCIsIFtdLCAoKSA9PiB1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0eXBlZCBjb250cm9sbGVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gLSBDb250cm9sbGVyIGluc3RhbmNlIHdpdGggZnJvbnRlbmQtbW9kZWwgaGVscGVycy5cbiAgICovXG4gIHR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9ICovICh0aGlzLmNvbnRyb2xsZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IC0gU3RhdGljIHJlc291cmNlIGNvbmZpZyAocmF3IHVzZXIgaW5wdXQgc2hhcGU7IGNvbnN1bWVycyBub3JtYWxpemUpLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhdHRyaWJ1dGVzXCIpXG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYWJpbGl0aWVzXCIpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnRDb25maWd1cmF0aW9ucygpXG4gICAgY29uc3QgY29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJjb21tYW5kc1wiKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIpXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIpXG4gICAgY29uc3QgY29sbGVjdGlvbkNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiY29sbGVjdGlvbkNvbW1hbmRzXCIpXG4gICAgY29uc3QgbWVtYmVyQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtZW1iZXJDb21tYW5kc1wiKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1vZGVsTmFtZVwiKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJwcmltYXJ5S2V5XCIpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInJlbGF0aW9uc2hpcHNcIilcbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzZXJ2ZXJcIilcbiAgICBjb25zdCBzeW5jID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwic3luY1wiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqL1xuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW119ICovIChhdHRyaWJ1dGVzIHx8IFtdKVxuICAgIH1cblxuICAgIGlmIChhYmlsaXRpZXMpIGNvbmZpZy5hYmlsaXRpZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYWJpbGl0aWVzKVxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgY29uZmlnLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoY29tbWFuZHMpIGNvbmZpZy5jb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChjb21tYW5kcylcbiAgICBpZiAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcykgY29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKSBjb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGJ1aWx0SW5NZW1iZXJDb21tYW5kcylcbiAgICBpZiAoY29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuY29sbGVjdGlvbkNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAobWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5tZW1iZXJDb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChtZW1iZXJDb21tYW5kcylcbiAgICBpZiAobW9kZWxOYW1lKSBjb25maWcubW9kZWxOYW1lID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChtb2RlbE5hbWUpXG4gICAgaWYgKHByaW1hcnlLZXkpIGNvbmZpZy5wcmltYXJ5S2V5ID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBzdHJpbmdbXX0gKi8gKHByaW1hcnlLZXkpXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMpIGNvbmZpZy5yZWxhdGlvbnNoaXBzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKHJlbGF0aW9uc2hpcHMpXG4gICAgaWYgKHNlcnZlcikgY29uZmlnLnNlcnZlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTZXJ2ZXJDb25maWd1cmF0aW9ufSAqLyAoc2VydmVyKVxuICAgIGlmIChzeW5jICE9PSB1bmRlZmluZWQpIGNvbmZpZy5zeW5jID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgYm9vbGVhbn0gKi8gKHN5bmMpXG5cbiAgICByZXR1cm4gY29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGNsaWVudC1mYWNpbmcgcmVzb3VyY2UgcHJpbWFyeSBrZXkgZnJvbSBleHBsaWNpdCByZXNvdXJjZSBjb25maWcgb3IgdGhlIGJhY2tpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gUmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gQ2xpZW50LWZhY2luZyBwcmltYXJ5IGtleS5cbiAgICovXG4gIHN0YXRpYyByZXNvbHZlZFByaW1hcnlLZXkocmVzb3VyY2VDb25maWd1cmF0aW9uKSB7XG4gICAgaWYgKHJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5KSByZXR1cm4gcmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXlcblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHRoaXMubW9kZWxDbGFzcygpKVxuICAgIGNvbnN0IG1vZGVsUHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShtb2RlbFByaW1hcnlLZXkpXG4gICAgICA/IG1vZGVsUHJpbWFyeUtleS5tYXAoKGNvbHVtbk5hbWUpID0+IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29sdW1uTmFtZSkgfHwgY29sdW1uTmFtZSlcbiAgICAgIDogbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShtb2RlbFByaW1hcnlLZXkpIHx8IG1vZGVsUHJpbWFyeUtleVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBDb250cm9sbGVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIGlmICghdGhpcy5jb250cm9sbGVyKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcblxuICAgIHJldHVybiB0aGlzLmNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbjogdGhlIGNvbnRyb2xsZXIncyB3aGVuIHRoZSByZXNvdXJjZVxuICAgKiBzZXJ2ZXMgYSBjb250cm9sbGVyIHJlcXVlc3QsIG90aGVyd2lzZSB0aGUgY29uc3RydWN0b3ItaW5qZWN0ZWRcbiAgICogY29uZmlndXJhdGlvbiAoZm9yIGV4YW1wbGUgYSBzeW5jIHdlYnNvY2tldCBjaGFubmVsJ3MgcmVzb3VyY2UpLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgY29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250cm9sbGVyKSByZXR1cm4gdGhpcy5jb250cm9sbGVySW5zdGFuY2UoKS5nZXRDb25maWd1cmF0aW9uKClcbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uVmFsdWUpIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIG9yIGFuIGluamVjdGVkIGNvbmZpZ3VyYXRpb24uYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gTW9kZWwgY2xhc3MuXG4gICAqL1xuICBtb2RlbENsYXNzKCkge1xuICAgIGlmICghdGhpcy5tb2RlbENsYXNzVmFsdWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgY2xhc3MuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkYXRhYmFzZSBtb2RlbCBjbGFzcyB1c2VkIGJ5IHNlcnZlci1vbmx5IHJlc291cmNlIG9wZXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtURGF0YWJhc2VNb2RlbENsYXNzfSAtIERhdGFiYXNlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZGF0YWJhc2VNb2RlbENsYXNzKCkge1xuICAgIC8vIE5hcnJvd3MgdGhlIHBvcnRhYmxlIHJlc291cmNlIGdlbmVyaWMgYXQgdGhlIGV4cGxpY2l0IGJhY2tlbmQtb3BlcmF0aW9uIGJvdW5kYXJ5LlxuICAgIHJldHVybiAvKiogQHR5cGUge1REYXRhYmFzZU1vZGVsQ2xhc3N9ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzLm1vZGVsQ2xhc3MoKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1aXJlZCBtb2RlbCBjbGFzcyBmb3IgYXV0aG9yaXphdGlvbiBoZWxwZXJzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHJlcXVpcmVkTW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTW9kZWwgbmFtZS5cbiAgICovXG4gIG1vZGVsTmFtZSgpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxOYW1lVmFsdWUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgbmFtZS5gKVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxOYW1lVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcmFtcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAtIFBhcmFtcy5cbiAgICovXG4gIHBhcmFtcygpIHsgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9ICovICh0aGlzLnBhcmFtc1ZhbHVlIHx8IHN1cGVyLnBhcmFtcygpIHx8IHt9KSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IC0gUmVzb3VyY2UgY29uZmlnIChub3JtYWxpemVkIGF0IHJ1bnRpbWU7IHJhdyBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAgICovXG4gIHJlc291cmNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5gKVxuXG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgUmFpbHMtc3Ryb25nLXBhcmFtcyAvIGFwaV9tYWtlci1zdHlsZSBwZXJtaXQgc3BlYyBkZWNsYXJpbmdcbiAgICogd2hpY2ggYXR0cmlidXRlcyBhbmQgbmVzdGVkIGF0dHJpYnV0ZXMgYXJlIHdyaXRhYmxlIGZvciB0aGUgY3VycmVudFxuICAgKiByZXF1ZXN0LiBTdWJtaXR0aW5nIGFuIGF0dHJpYnV0ZSBvciBuZXN0ZWQtcmVsYXRpb25zaGlwIGtleSB0aGF0IGlzXG4gICAqIG5vdCBwZXJtaXR0ZWQgcmFpc2VzIGFuIGVycm9yIGFuZCBmYWlscyB0aGUgd3JpdGUuXG4gICAqXG4gICAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIGZsYXQgYXJyYXkgdGhhdCBtaXhlczpcbiAgICogICAtIGBcImF0dHJpYnV0ZU5hbWVcImAgc3RyaW5ncyBmb3IgcGxhaW4gYXR0cmlidXRlIHdyaXRlc1xuICAgKiAgIC0gYHs8cmVsYXRpb25zaGlwTmFtZT5BdHRyaWJ1dGVzOiBbLi4uXX1gIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlXG4gICAqICAgICBpcyBpdHNlbGYgYSBwZXJtaXQgc3BlYyBmb3IgdGhlIG5lc3RlZCByZWxhdGlvbnNoaXBcbiAgICpcbiAgICogVGhpcyBtYXRjaGVzIFJhaWxzIHN0cm9uZ19wYXJhbXMgKGBwZXJtaXQoOmZpcnN0X25hbWUsIDpsYXN0X25hbWUsXG4gICAqIGNvbnRhY3RfYXR0cmlidXRlczogWzplbWFpbCwgZGV0YWlsc19hdHRyaWJ1dGVzOiBbOmRldGFpbF1dKWApIGFuZFxuICAgKiB0aGUgYXBpX21ha2VyIHNpc3RlciBwcm9qZWN0LiBJbmNsdWRlIGBcIl9kZXN0cm95XCJgIGluc2lkZSBhIG5lc3RlZFxuICAgKiBwZXJtaXQgdG8gYWxsb3cgYF9kZXN0cm95OiB0cnVlYCBlbnRyaWVzIGZvciB0aGF0IHJlbGF0aW9uc2hpcCDigJRcbiAgICogdGhlIG1vZGVsIG11c3QgYWxzbyBkZWNsYXJlIGBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihuYW1lLFxuICAgKiB7YWxsb3dEZXN0cm95OiB0cnVlfSlgIGZvciB0aGUgZGVzdHJveSB0byBiZSBhcHBsaWVkLlxuICAgKlxuICAgKiBFeGFtcGxlOlxuICAgKlxuICAgKiAgIGNsYXNzIFByb2plY3RSZXNvdXJjZSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uge1xuICAgKiAgICAgcGVybWl0dGVkUGFyYW1zKGFyZykge1xuICAgKiAgICAgICByZXR1cm4gW1xuICAgKiAgICAgICAgIFwibmFtZVwiLFxuICAgKiAgICAgICAgIFwiZGVzY3JpcHRpb25cIixcbiAgICogICAgICAgICB7dGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiLFxuICAgKiAgICAgICAgICAge3N1YnRhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gICAqICAgICAgICAgXX1cbiAgICogICAgICAgXVxuICAgKiAgICAgfVxuICAgKiAgIH1cbiAgICpcbiAgICogRGVmYXVsdCBpbXBsZW1lbnRhdGlvbiByZXR1cm5zIHRoZSBkZWNsYXJlZFxuICAgKiB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS53cml0YWJsZUF0dHJpYnV0ZXN9IHBlcm1pdCBsaXN0LCBvciBgW11gXG4gICAqIOKAlCBub3RoaW5nIHBlcm1pdHRlZCDigJQgd2l0aG91dCBhIGRlY2xhcmVkIGxpc3QuIFN1YmNsYXNzZXMgb3ZlcnJpZGUgdG9cbiAgICogY3VzdG9taXplOyBhbiBleHBsaWNpdCBvdmVycmlkZSBhbHdheXMgd2lucy5cbiAgICogQHBhcmFtIHt7YWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYWJpbGl0eT86IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0LCBsb2NhbHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBbYXJnXSAtIFJlcXVlc3QgY29udGV4dC5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGVybWl0IHNwZWMuXG4gICAqL1xuICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcInBlcm1pdHRlZFBhcmFtc1wiLCBbYXJnXSwgKCkgPT4ge1xuICAgICAgdm9pZCBhcmdcblxuICAgICAgcmV0dXJuIHRoaXMuZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSA/PyBbXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCBmcm9tIHRoZSBlbnZpcm9ubWVudFxuICAgKiByZXNvdXJjZSBmaXJzdCwgdGhlbiB0aGUgc2hhcmVkIHJlc291cmNlIOKAlCBtaXJyb3JpbmcgaG93IHRoZSBvdGhlclxuICAgKiBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIHJlc29sdmVzLiBBbiBleHBsaWNpdCBlbnZpcm9ubWVudCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucyBvdmVyIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSBEZWNsYXJlZCBwZXJtaXQgbGlzdCBvciBudWxsIHdoZW4gdW5kZWNsYXJlZC5cbiAgICovXG4gIGRlY2xhcmVkV3JpdGFibGVBdHRyaWJ1dGVzKCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBwZXJtaXR0ZWRBdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWR9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIikpXG5cbiAgICByZXR1cm4gcGVybWl0dGVkQXR0cmlidXRlcyA/PyBudWxsXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBjbGllbnQtc2FmZSBlcnJvciB0aHJvd24gZm9yIGEgZmFpbGVkIHdyaXRhYmxlLWF0dHJpYnV0ZSB2YWxpZGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7Y2F1c2U/OiBFcnJvciwgY29kZTogc3RyaW5nfX0gZGV0YWlscyAtIFN0YWJsZSBtYWNoaW5lLXJlYWRhYmxlIGNvZGUgYW5kIG9wdGlvbmFsIGNhdXNlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IENsaWVudC1zYWZlIGVycm9yLlxuICAgKi9cbiAgd3JpdGFibGVBdHRyaWJ1dGVFcnJvcihtZXNzYWdlLCB7Y2F1c2UsIGNvZGV9KSB7XG4gICAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUobWVzc2FnZSwgY2F1c2UgPyB7Y2F1c2UsIGNvZGV9IDoge2NvZGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhvcml6ZXMgb25lIHJvdXRlZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBiZWZvcmUgaXQgaXMgYXBwbGllZC5cbiAgICogRGVmYXVsdHMgdG8gYWxsb3dpbmcgZXZlcnkgbXV0YXRpb247IHJlY29yZC1sZXZlbCBhdXRob3JpemF0aW9uIHN0aWxsXG4gICAqIGFwcGxpZXMgdGhyb3VnaCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNmaW5kU3luY1JlY29yZH0gc2NvcGluZ1xuICAgKiBhbmQgdGhlIGNyZWF0ZSBtZW1iZXJzaGlwIGNoZWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb24gfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbj59IEF1dGhvcml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXV0aG9yaXplU3luY011dGF0aW9uKHtjb250ZXh0LCBtdXRhdGlvbn0pIHtcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4ge2FsbG93ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcGVyLXN5bmMgZmFpbHVyZSByZWFzb24gcmVwb3J0ZWQgd2hlbiBhIHJvdXRlZCBzeW5jIG11dGF0aW9uXG4gICAqIGZhaWxzIHJlY29yZC1sZXZlbCBhdXRob3JpemF0aW9uLiBEZWZhdWx0cyB0byBudWxsLCB3aGljaCByZXBvcnRzIHRoZVxuICAgKiBnZW5lcmljIFwiYWNjZXNzLWRlbmllZFwiIHJlYXNvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGFyZ3MuYWN0aW9uIC0gRGVuaWVkIGFjdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSBvciBudWxsIGZvciB0aGUgZ2VuZXJpYyBkZWZhdWx0LlxuICAgKi9cbiAgc3luY0F1dGhvcml6YXRpb25GYWlsdXJlUmVhc29uKHthY3Rpb24sIG11dGF0aW9ufSkge1xuICAgIHZvaWQgYWN0aW9uXG4gICAgdm9pZCBtdXRhdGlvblxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZXhpc3RpbmcgcmVjb3JkIHRhcmdldGVkIGJ5IGEgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBEZWZhdWx0cyB0byBhbiBgYWNjZXNzaWJsZUZvcmAgbG9va3VwIGJ5IHByaW1hcnkga2V5IHRocm91Z2ggdGhlXG4gICAqIHJlc291cmNlJ3Mgbm9ybWFsaXplZCBhYmlsaXR5IGFjdGlvbiBmb3IgdXBkYXRlIChvciBkZXN0cm95IGZvciBkZWxldGVcbiAgICogbXV0YXRpb25zKSwgZmFsbGluZyBiYWNrIHRvIGFuIHVuc2NvcGVkIGxvb2t1cCB3aXRob3V0IGFuIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FyZ3MuYWJpbGl0eV0gLSBBYmlsaXR5IG92ZXJyaWRlLiBEZWZhdWx0cyB0byB0aGUgcmVzb3VyY2UgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5mb3JEZWxldGVdIC0gV2hldGhlciB0aGUgbG9va3VwIGlzIGZvciBhIGRlbGV0ZSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IEV4aXN0aW5nIHJlY29yZCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZmluZFN5bmNSZWNvcmQoe2FiaWxpdHkgPSB0aGlzLmFiaWxpdHksIGZvckRlbGV0ZSA9IGZhbHNlLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyBNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5zeW5jQWJpbGl0eUFjdGlvbihmb3JEZWxldGUgPyBcImRlc3Ryb3lcIiA6IFwidXBkYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgOiBNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHRoaXMucHJpbWFyeUtleSgpLCBtdXRhdGlvbi5yZXNvdXJjZUlkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgcmF3IHN5bmMgYWN0aW9uIHRvIHRoZSByZXNvdXJjZSdzIG5vcm1hbGl6ZWQgYWJpbGl0eSBhY3Rpb24gd2hlblxuICAgKiB0aGUgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBkZWNsYXJlcyBhbiBhYmlsaXRpZXMgbWFwcGluZywgb3RoZXJ3aXNlIHRoZVxuICAgKiByYXcgYWN0aW9uIG5hbWUgaXMgdXNlZCBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBhY3Rpb24gLSBSYXcgc3luYyBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEFiaWxpdHkgYWN0aW9uLlxuICAgKi9cbiAgc3luY0FiaWxpdHlBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZT8uYWJpbGl0aWVzXG5cbiAgICBpZiAoYWJpbGl0aWVzICYmIHR5cGVvZiBhYmlsaXRpZXMgPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uID09IFwic3RyaW5nXCIgJiYgYWJpbGl0eUFjdGlvbi5sZW5ndGggPiAwKSByZXR1cm4gYWJpbGl0eUFjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGdWxsIGVzY2FwZSBoYXRjaCBmb3Igcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uIFJldHVybmluZyBhXG4gICAqIG5vbi1udWxsIHJlc3VsdCByZXBsYWNlcyB0aGUgd2hvbGUgZGVmYXVsdCBhcHBseSBmbG93IChhdXRob3JpemF0aW9uLFxuICAgKiByZWNvcmQgbG9va3VwLCBub3JtYWxpemF0aW9uIGFuZCBzYXZlKSB3aXRoIHRoZSByZXR1cm5lZCBhcHBseSByZXN1bHQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3N9IGFyZ3MgLSBBcHBseSBhcmdzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGwgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHQgfCBudWxsPn0gQXBwbHkgcmVzdWx0IG9yIG51bGwgZm9yIHRoZSBkZWZhdWx0IGZsb3cuXG4gICAqL1xuICBhcHBseVN5bmMoYXJncykge1xuICAgIHZvaWQgYXJnc1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGEgcm91dGVkIHN5bmMgbXV0YXRpb24gd2FzIGFwcGxpZWQuIFJldHVybmVkIGVudHJpZXMgYXJlXG4gICAqIG1lcmdlZCBpbnRvIHRoZSBhcHBseSByZXN1bHQsIHJlYWNoaW5nIHBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgYW5kXG4gICAqIGJyb2FkY2FzdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY3JlYXRlZCAtIFdoZXRoZXIgdGhlIHJlY29yZCB3YXMgY3JlYXRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBhcmdzLnJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEV4dHJhIGFwcGx5LXJlc3VsdCBlbnRyaWVzLlxuICAgKi9cbiAgYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQsIG11dGF0aW9uLCByZWNvcmR9KSB7XG4gICAgdm9pZCBjb250ZXh0XG4gICAgdm9pZCBjcmVhdGVkXG4gICAgdm9pZCBtdXRhdGlvblxuICAgIHZvaWQgcmVjb3JkXG5cbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGNyZWF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzXCIsIFthdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBvcHRpb25zXG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHVwZGF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwibm9ybWFsaXplVXBkYXRlQXR0cmlidXRlc1wiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBOZXcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyQ3JlYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBVcGRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyVXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZURlc3Ryb3kobW9kZWwpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRGVzdHJveWVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlckRlc3Ryb3lcIiwgW21vZGVsXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV3JhcHMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IHJlc291cmNlIG11dGF0aW9ucy5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBNdXRhdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNdXRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmVzdWx0Pn0gYXJncy5jYWxsYmFjayAtIE11dGF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe2FjdGlvbiwgbW9kZWwsIGNhbGxiYWNrfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJydW5NdXRhdGlvblRyYW5zYWN0aW9uXCIsIFt7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9XSwgYXN5bmMgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cbiAgICAgIHZvaWQgbW9kZWxcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIFByaW1hcnkga2V5LlxuICAgKi9cbiAgcHJpbWFyeUtleSgpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG5cbiAgICByZXR1cm4gUmVzb3VyY2VDbGFzcy5yZXNvbHZlZFByaW1hcnlLZXkodGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24oKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9ufSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIGF1dGhvcml6ZWRRdWVyeShhY3Rpb24pIHtcbiAgICAvLyBOYXJyb3dzIHRoZSBjb250cm9sbGVyIHF1ZXJ5IHRvIHRoaXMgcmVzb3VyY2UncyBtb2RlbCBjbGFzcy5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59IC0gRnJvbnRlbmQtbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqL1xuICBpbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEluZGV4UXVlcnkoe1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBwYWdpbmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9ufSBhcmdzLnBhZ2luYXRpb24gLSBQYWdpbmF0aW9uIHBhcmFtcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4UGFnaW5hdGlvbih7Y29udHJvbGxlciwgcGFnaW5hdGlvbiwgcXVlcnl9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtwYWdpbmF0aW9uLCBxdWVyeX0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBzZWFyY2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlciwgcXVlcnksIHNlYXJjaH0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaCh7cXVlcnksIHNlYXJjaH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBzb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNvcnQgYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9IGFyZ3Muc29ydCAtIFNvcnQgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydCh7Y29udHJvbGxlciwgcXVlcnksIHNvcnR9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTb3J0KHtxdWVyeSwgc29ydH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBwbHVjay5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBwbHVjayBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c1BsdWNrKGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLnJlY29yZHMgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLnJlY29yZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGNvdW50LlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNvdW50IGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQ291bnQoYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykucmVjb3JkcyA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUucmVjb3JkcyB8fFxuICAgICAgT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLmNvdW50ICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5jb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IHZvaWQgfCBQcm9taXNlPGJvb2xlYW4gfCB2b2lkPn0gLSBDb250aW51ZSBwcm9jZXNzaW5nIHVubGVzcyBmYWxzZS5cbiAgICovXG4gIGJlZm9yZUFjdGlvbihhY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQWN0aW9uXCIsIFthY3Rpb25dLCAoKSA9PiB7XG4gICAgICB2b2lkIGFjdGlvblxuXG4gICAgICAvLyBOby1vcCBieSBkZWZhdWx0LlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBSZWNvcmRzIGZvciBpbmRleCBhY3Rpb24uXG4gICAqL1xuICBhc3luYyByZWNvcmRzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmluZGV4UXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5IG9wdGlvbnMgZm9yIGNvdW50LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnN9IC0gSW5kZXggcXVlcnkgb3B0aW9ucyBmb3IgY291bnQuXG4gICAqL1xuICBjb3VudEluZGV4UXVlcnlPcHRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVjb3JkcyBjb3VudCBmb3IgaW5kZXggYWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5kZXhRdWVyeSh0aGlzLmNvdW50SW5kZXhRdWVyeU9wdGlvbnMoKSkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHBhcmFtIHtcImZpbmRcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGlkIC0gUmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIExvY2F0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kKGFjdGlvbiwgaWQpIHtcbiAgICBsZXQgcXVlcnkgPSB0aGlzLmF1dGhvcml6ZWRRdWVyeShhY3Rpb24pXG4gICAgY29uc3QgcHJlbG9hZCA9IGFjdGlvbiA9PT0gXCJmaW5kXCIgPyB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbFByZWxvYWQoKSA6IG51bGxcblxuICAgIGlmIChwcmVsb2FkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQocHJlbG9hZClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZmluZEJ5KG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnModGhpcy5wcmltYXJ5S2V5KCksIGlkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gQ3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IFtvcHRpb25zXSAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIENyZWF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcImNyZWF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhNb2RlbENsYXNzLnByb3RvdHlwZSwgTW9kZWxDbGFzcywgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiY3JlYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlQ3JlYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlckNyZWF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgdW5hdXRob3JpemVkIGNyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQ3JlYXRlZCBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ2xlYW51cCBhZnRlciBmYWlsZWQgYXV0aG9yaXphdGlvbi5cbiAgICovXG4gIGFzeW5jIGhhbmRsZVVuYXV0aG9yaXplZENyZWF0ZWRNb2RlbChtb2RlbCkge1xuICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBVcGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gVXBkYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsLCBtb2RlbC5nZXRNb2RlbENsYXNzKCksIGF0dGFjaG1lbnRTcGxpdC5hdHRyaWJ1dGVzLCB0aGlzLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe1xuICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZVVwZGF0ZShtb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgICAgIGNvbnN0IHNhdmVkTW9kZWwgPSBhd2FpdCB0aGlzLl9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9uczogey4uLm9wdGlvbnMsIGF0dGFjaG1lbnRzOiBhdHRhY2htZW50U3BsaXQuYXR0YWNobWVudHN9LCBwZXJtaXR9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJVcGRhdGUoc2F2ZWRNb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG5cbiAgICAgICAgcmV0dXJuIHNhdmVkTW9kZWxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgbW9kZWwgYW5kIGFwcGxpZXMgbmVzdGVkIGF0dHJpYnV0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tmaWx0ZXJlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIG9wdGlvbnM6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zLCBwZXJtaXQ6IHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fX0gYXJncyAtIFNhdmUgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnMsIHBlcm1pdH0pIHtcbiAgICBhd2FpdCB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhtb2RlbCwgZmlsdGVyZWQpXG4gICAgICB0aGlzLl9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgICAgaWYgKG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMobW9kZWwsIG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcywgb3B0aW9ucy5jb250cm9sbGVyIHx8IG51bGwsIHBlcm1pdClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICAgIGlmIChvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKG1vZGVsLCBvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMsIG9wdGlvbnMuY29udHJvbGxlciB8fCBudWxsLCBwZXJtaXQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX3ByZWxvYWROZXN0ZWRXcml0YWJsZVJlbGF0aW9uc2hpcHMobW9kZWwsIHBlcm1pdClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgYXR0cmlidXRlcyB0byBhIG1vZGVsLCB1c2luZyB2aXJ0dWFsIHNldHRlcnMgb24gdGhlIHJlc291cmNlIHdoZW4gYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMobW9kZWwsIGF0dHJpYnV0ZXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBkaXJlY3RBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgdHJhbnNsYXRlZFNldCA9IG5ldyBTZXQoUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdKVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZVNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpfUF0dHJpYnV0ZWBcbiAgICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gdGhpcy5yZXNvdXJjZU1ldGhvZChyZXNvdXJjZVNldHRlck5hbWUpXG5cbiAgICAgIGlmIChyZXNvdXJjZVNldHRlcikge1xuICAgICAgICBhd2FpdCByZXNvdXJjZVNldHRlci5tZXRob2QuY2FsbChyZXNvdXJjZVNldHRlci5yZXNvdXJjZSwgbW9kZWwsIHZhbHVlKVxuICAgICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhuYW1lKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlT25Nb2RlbChtb2RlbCwgbmFtZSwgdmFsdWUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaXJlY3RBdHRyaWJ1dGVzW25hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGlyZWN0QXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgbW9kZWwuYXNzaWduKGRpcmVjdEF0dHJpYnV0ZXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBhdHRhY2htZW50LW5hbWVkIGF0dHJpYnV0ZXMgaW50byB0aGUgYXR0YWNobWVudCBwYXlsb2FkIHdoaWxlIHByZXNlcnZpbmcgbGVnYWN5IGNhbGxlcnNcbiAgICogdGhhdCBzdWJtaXR0ZWQgYXR0YWNobWVudHMgYXMgbm9ybWFsIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEV4cGxpY2l0IGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGF0dGFjaG1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfX0gQXR0cmlidXRlcyB3aXRoIGF0dGFjaG1lbnQga2V5cyByZW1vdmVkIGFuZCBtZXJnZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBhdHRhY2htZW50cykge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRoaXMubW9kZWxDbGFzcygpLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgYXR0YWNobWVudE5hbWVzID0gbmV3IFNldChPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpKVxuXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lcy5zaXplID09PSAwKSByZXR1cm4ge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzfVxuXG4gICAgaWYgKGF0dGFjaG1lbnRzICE9PSBudWxsICYmICFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlZ3VsYXJBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IG1lcmdlZEF0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgPyB7Li4uYXR0YWNobWVudHN9IDogbnVsbFxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoIWF0dGFjaG1lbnROYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgcmVndWxhckF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1lcmdlZEF0dGFjaG1lbnRzKSBtZXJnZWRBdHRhY2htZW50cyA9IHt9XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1lcmdlZEF0dGFjaG1lbnRzLCBhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJyR7YXR0cmlidXRlTmFtZX0nIHdhcyBzdWJtaXR0ZWQgaW4gYm90aCBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cy5gKVxuICAgICAgfVxuXG4gICAgICBtZXJnZWRBdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHthdHRyaWJ1dGVzOiByZWd1bGFyQXR0cmlidXRlcywgYXR0YWNobWVudHM6IG1lcmdlZEF0dGFjaG1lbnRzfVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhdHRhY2htZW50IHBheWxvYWRzIG9uIGEgbW9kZWwgYWZ0ZXIgdmFsaWRhdGluZyBwZXJtaXRzIGFuZCBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHJlY2VpdmluZyBhdHRhY2htZW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEF0dGFjaG1lbnRzIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGVybWl0dGVkQXR0cmlidXRlTmFtZXMgLSBBdHRyaWJ1dGUvYXR0YWNobWVudCBuYW1lcyBwZXJtaXR0ZWQgYnkgdGhlIHJlc291cmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgYXR0YWNobWVudHMsIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSB7XG4gICAgaWYgKCFhdHRhY2htZW50cykgcmV0dXJuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuXG4gICAgY29uc3QgcGVybWl0U2V0ID0gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcylcbiAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gbW9kZWxDbGFzcy5nZXRBdHRhY2htZW50c01hcCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBub3RQZXJtaXR0ZWRBdHRhY2htZW50cyA9IFtdXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBpbnZhbGlkQXR0YWNobWVudHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghcGVybWl0U2V0LmhhcyhhdHRhY2htZW50TmFtZSkpIHtcbiAgICAgICAgbm90UGVybWl0dGVkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb25zW2F0dGFjaG1lbnROYW1lXSkge1xuICAgICAgICBpbnZhbGlkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbW9kZWwuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkucXVldWVBdHRhY2godmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgbmFtZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgICBpZiAoaW52YWxpZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lczogJHtpbnZhbGlkQXR0YWNobWVudHMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHRyYW5zbGF0ZWQgYXR0cmlidXRlIG9uIGEgbW9kZWwgdmlhIHRoZSB0cmFuc2xhdGlvbnMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gdmFsdWUgLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQ/LmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uID8gY29uZmlndXJhdGlvbi5nZXRMb2NhbGUoKSA6IFwiZW5cIlxuICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwidHJhbnNsYXRpb25zXCIpXG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgdHJhbnNsYXRpb24gPSBsb2FkZWQuZmluZCgodCkgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0KS5sb2NhbGUoKSA9PT0gbG9jYWxlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGF3YWl0IG1vZGVsLmxvYWRSZWxhdGlvbnNoaXAoXCJ0cmFuc2xhdGlvbnNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgdHJhbnNsYXRpb24gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5idWlsZCh7bG9jYWxlfSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IHt9XG5cbiAgICBhc3NpZ25tZW50c1tuYW1lXSA9IHZhbHVlXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveShtb2RlbCkge1xuICAgIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZURlc3Ryb3kobW9kZWwpXG4gICAgICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyRGVzdHJveShtb2RlbClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHRvIHNlcmlhbGl6ZS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwifSBbYWN0aW9uXSAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemUobW9kZWwsIGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY29tbW9uIG1ldGFkYXRhIGZvciBvbmUgbmVzdGVkLWF0dHJpYnV0ZXMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5lc3RlZCByZWxhdGlvbnNoaXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCByZWNlaXZpbmcgbmVzdGVkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgZnJvbSB0aGUgcmVxdWVzdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgY2hpbGQgcmVzb3VyY2UgbG9va3VwLlxuICAgKiBAcmV0dXJucyB7e2FiaWxpdHk6IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBjaGlsZFJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLCBjaGlsZFJlc291cmNlQ29uZmlnOiBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSwgZGVzdHJveVBlcm1pdHRlZDogYm9vbGVhbiwgZW50cmllczogQXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+LCByZWxhdGlvbnNoaXA6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCwgdGFyZ2V0TW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gTmVzdGVkIHJlbGF0aW9uc2hpcCBjb250ZXh0LlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe3BhcmVudCwgcmVsYXRpb25zaGlwTmFtZSwgcmF3RW50cmllcywgY2hpbGRQZXJtaXQsIGNvbnRyb2xsZXJ9KSB7XG4gICAgaWYgKCFjb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgcmVxdWlyZSBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcbiAgICB9XG5cbiAgICBjb25zdCBwYXJlbnRNb2RlbENsYXNzID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IG1vZGVsQWNjZXB0YW5jZSA9IHBhcmVudE1vZGVsQ2xhc3MuYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIW1vZGVsQWNjZXB0YW5jZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWNjZXB0IG5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIERlY2xhcmUgaXQgdmlhICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScpLmApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcGFyZW50TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgIGNvbnN0IHJhd05vcm1hbGl6ZWRFbnRyaWVzID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pXG4gICAgY29uc3QgZGVzdHJveVBlcm1pdHRlZCA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJfZGVzdHJveVwiKVxuXG4gICAgaWYgKGRlc3Ryb3lQZXJtaXR0ZWQgJiYgIW1vZGVsQWNjZXB0YW5jZS5hbGxvd0Rlc3Ryb3kpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgcGVybWl0cyBfZGVzdHJveSBvbiBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IHRoZSBtb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWxsb3cgZGVzdHJveSBmb3IgdGhhdCByZWxhdGlvbnNoaXAuIFNldCB7YWxsb3dEZXN0cm95OiB0cnVlfSBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nLCAuLi4pLmApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLmxpbWl0ID09PSBcIm51bWJlclwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IG1vZGVsQWNjZXB0YW5jZS5saW1pdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZXhjZWVkcyBtb2RlbC1kZWNsYXJlZCBsaW1pdCBvZiAke21vZGVsQWNjZXB0YW5jZS5saW1pdH0uYClcbiAgICB9XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzTWFueVwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGFjY2VwdHMgb25lIGVudHJ5IGZvciAke3JlbGF0aW9uc2hpcFR5cGV9IHJlbGF0aW9uc2hpcHMuYClcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyByZXNvbHZlZCBmb3IgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlQ29uZmlnID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCFjaGlsZFJlc291cmNlQ29uZmlnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdGVyZWQgZm9yIGNoaWxkIG1vZGVsICcke3RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyB1bmRlciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nLmApXG4gICAgfVxuXG4gICAgY29uc3QgQ2hpbGRSZXNvdXJjZSA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNsYXNzKVxuICAgIGNvbnN0IGNoaWxkUmVzb3VyY2UgPSBuZXcgQ2hpbGRSZXNvdXJjZSh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0IHx8IHt9LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBtb2RlbE5hbWU6IGNoaWxkUmVzb3VyY2VDb25maWcubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiX2Rlc3Ryb3lcIilcbiAgICBjb25zdCBlbnRyaWVzID0gcmF3Tm9ybWFsaXplZEVudHJpZXNcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbiwgZW50cnksIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSlcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgcmV0dXJuICFtb2RlbEFjY2VwdGFuY2UucmVqZWN0SWYoaXNQbGFpbk9iamVjdChlbnRyeS5hdHRyaWJ1dGVzKSA/IGVudHJ5LmF0dHJpYnV0ZXMgOiB7fSlcbiAgICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgYWJpbGl0eTogY29udHJvbGxlci5jdXJyZW50QWJpbGl0eSgpIHx8IHRoaXMuYWJpbGl0eSxcbiAgICAgIGNoaWxkUmVzb3VyY2UsXG4gICAgICBjaGlsZFJlc291cmNlQ29uZmlnLFxuICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICBkZXN0cm95UGVybWl0dGVkLFxuICAgICAgZW50cmllcyxcbiAgICAgIHJlbGF0aW9uc2hpcCxcbiAgICAgIHRhcmdldE1vZGVsQ2xhc3NcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBuZXN0ZWQgZW50cmllcyBmb3IgY29sbGVjdGlvbiBhbmQgc2luZ3VsYXIgcmVsYXRpb25zaGlwcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOZXN0ZWQgZW50cmllcyBpbnB1dHMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwVHlwZSAtIFJlbGF0aW9uc2hpcCB0eXBlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeSBvYmplY3RzLlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcEVudHJpZXMoe3Jhd0VudHJpZXMsIHJlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFR5cGV9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT09IFwiaGFzTWFueVwiKSB7XG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhcnJheSBmb3IgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCBnb3Q6ICR7dHlwZW9mIHJhd0VudHJpZXN9YClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJhd0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyaWVzIG11c3QgYmUgb2JqZWN0cy5gKVxuXG4gICAgICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKGVudHJ5KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAocmF3RW50cmllcyA9PSBudWxsKSByZXR1cm4gW11cbiAgICBpZiAoQXJyYXkuaXNBcnJheShyYXdFbnRyaWVzKSkge1xuICAgICAgcmV0dXJuIHJhd0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyaWVzIG11c3QgYmUgb2JqZWN0cy5gKVxuXG4gICAgICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKGVudHJ5KVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHJhd0VudHJpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIG9iamVjdCBmb3IgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGJ1dCBnb3Q6ICR7dHlwZW9mIHJhd0VudHJpZXN9YClcbiAgICB9XG5cbiAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICByZXR1cm4gWy8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChyYXdFbnRyaWVzKV1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBuZXN0ZWQgZW50cnkgZnJvbSBlaXRoZXIgaW50ZXJuYWwgdHJhbnNwb3J0IHNoYXBlXG4gICAqIChge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzLCBuZXN0ZWRBdHRyaWJ1dGVzfWApIG9yIGRpcmVjdCBSYWlscy1zdHlsZVxuICAgKiBmaWVsZHMgKGB7bmFtZSwgZmlsZSwgY29tbWVudHNBdHRyaWJ1dGVzfWApLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5vcm1hbGl6YXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdCBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSBhcmdzLmVudHJ5IC0gUmF3IG5lc3RlZCBlbnRyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9IE5vcm1hbGl6ZWQgbmVzdGVkIGVudHJ5LlxuICAgKi9cbiAgX25vcm1hbGl6ZU5lc3RlZFJlbGF0aW9uc2hpcEVudHJ5KHtjaGlsZFBlcm1pdCwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIikge1xuICAgICAgICBjb25zdCBwcmltYXJ5S2V5ID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSB8fCB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgICAgIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgdmFsdWUpXG4gICAgICAgIG5vcm1hbGl6ZWQuaWQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSAqLyAodmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcIl9kZXN0cm95XCIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJib29sZWFuXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBfZGVzdHJveSBtdXN0IGJlIGEgYm9vbGVhbi5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbm9ybWFsaXplZC5fZGVzdHJveSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImF0dHJpYnV0ZXNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0LmApXG4gICAgICAgIE9iamVjdC5hc3NpZ24oYXR0cmlidXRlcywgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImF0dGFjaG1lbnRzXCIpIHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgYXR0YWNobWVudHMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRhY2htZW50cywgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcIm5lc3RlZEF0dHJpYnV0ZXNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBuZXN0ZWRBdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0LmApXG4gICAgICAgIE9iamVjdC5hc3NpZ24obmVzdGVkQXR0cmlidXRlcywgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lLmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkge1xuICAgICAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuXG4gICAgICAgIGlmICghbmVzdGVkUmVsYXRpb25zaGlwTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG5lc3RlZCBhdHRyaWJ1dGVzIGtleTogJHthdHRyaWJ1dGVOYW1lfWApXG4gICAgICAgIGlmICghY2hpbGRQZXJtaXQubmVzdGVkW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7bmVzdGVkUmVsYXRpb25zaGlwTmFtZX0nIGFyZSBub3QgcGVybWl0dGVkIHVuZGVyICcke3JlbGF0aW9uc2hpcE5hbWV9Jy4gSW5jbHVkZSB7JHthdHRyaWJ1dGVOYW1lfTogWy4uLl19IGluIHRoYXQgbmVzdGVkIHBlcm1pdC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbnNbYXR0cmlidXRlTmFtZV0pIHtcbiAgICAgICAgYXR0YWNobWVudHNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBub3JtYWxpemVkLm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYmVsb25ncy10byBuZXN0ZWQgYXR0cmlidXRlcyBiZWZvcmUgdGhlIHBhcmVudCBzYXZlIHNvIHRoZSBwYXJlbnQgRksgY2FuIGJlIHNldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IG5lc3RlZEF0dHJpYnV0ZXMgLSBOZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGwgfCB1bmRlZmluZWR9IGNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciByZXNvdXJjZSByZXNvbHV0aW9uIGFuZCBhdXRob3JpemF0aW9uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwgbnVsbH0gW3BhcmVudFBlcm1pdF0gLSBQYXJzZWQgcGFyZW50IHBlcm1pdCBzcGVjLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMocGFyZW50LCBuZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBwYXJlbnRQZXJtaXQgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRQYXJlbnQgPSBwYXJlbnRQZXJtaXRcbiAgICAgIHx8IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwidXBkYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiB7fX0pKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBjaGlsZFBlcm1pdCA9IHJlc29sdmVkUGFyZW50Lm5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIWNoaWxkUGVybWl0KSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7XG4gICAgICAgIGNoaWxkUGVybWl0LFxuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJhd0VudHJpZXM6IG5lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV0sXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb250ZXh0LnJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSB0aGlzLl9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwoY29udGV4dC5yZWxhdGlvbnNoaXAsIHBhcmVudC5nZXRNb2RlbENsYXNzKCkpXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udGV4dC5lbnRyaWVzKSB7XG4gICAgICAgIGlmIChlbnRyeS5fZGVzdHJveSkge1xuICAgICAgICAgIGlmICghY29udGV4dC5kZXN0cm95UGVybWl0dGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSByZXF1ZXN0ZWQgX2Rlc3Ryb3kgYnV0IFwiX2Rlc3Ryb3lcIiBpcyBub3QgaW4gdGhlIHBlcm1pdCBmb3IgdGhpcyByZWxhdGlvbnNoaXAuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuXG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kTmVzdGVkUmVjb3JkKHtcbiAgICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuZGVzdHJveShleGlzdGluZylcbiAgICAgICAgICBwYXJlbnQuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIG51bGwpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcbiAgICAgICAgY29uc3QgY2hpbGQgPSBpZCAhPSB1bmRlZmluZWRcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBpZCxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgY2hpbGQuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2F1dGhvcml6ZUNyZWF0ZWRDaGlsZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZW50cnkubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgfVxuXG4gICAgICAgIHBhcmVudC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUoY2hpbGQuaWQoKSwgYE5lc3RlZCBiZWxvbmdzLXRvIHdyaXRlIGZvciAke2NoaWxkLmdldE1vZGVsQ2xhc3MoKS5uYW1lfWApKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgYG5lc3RlZEF0dHJpYnV0ZXNgIHBheWxvYWQgdG8gYSBmcmVzaGx5LXNhdmVkIHBhcmVudCBtb2RlbCxcbiAgICogY2FzY2FkaW5nIGNyZWF0ZS91cGRhdGUvZGVzdHJveSB3cml0ZXMgYWNyb3NzIHRoZSBkZWNsYXJlZCByZWxhdGlvbnNoaXBzLlxuICAgKlxuICAgKiBFYWNoIGNoaWxkIGlzIGF1dGhvcml6ZWQgYWdhaW5zdCBpdHMgb3duIHJlc291cmNlJ3MgYWJpbGl0aWVzIChuZXZlciB0aGVcbiAgICogcGFyZW50J3MpLiBEZXN0cm95cyBydW4gYmVmb3JlIHVwZGF0ZXMsIHVwZGF0ZXMgYmVmb3JlIGNyZWF0ZXMsIHRvIGF2b2lkXG4gICAqIHVuaXF1ZS1jb25zdHJhaW50IGNvbmZsaWN0cyB3aGVuIHJlcGxhY2luZyBhIGNoaWxkIGF0IHRoZSBzYW1lIG5hdHVyYWwga2V5LlxuICAgKlxuICAgKiBBdHRyaWJ1dGUgZmlsdGVyaW5nIGZvciBuZXN0ZWQgY2hpbGRyZW4gdXNlcyB0aGUgcGFyZW50IHJlc291cmNlJ3NcbiAgICogcGVybWl0IHNwZWMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlCBhcGlfbWFrZXItc3R5bGUuIFBvbGljeSBvcHRpb25zXG4gICAqIChhbGxvd0Rlc3Ryb3ksIGxpbWl0LCByZWplY3RJZikgY29tZSBmcm9tIHRoZSBNT0RFTCdzXG4gICAqIGBhY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IobmFtZSlgIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nIGFyZSBub3QgcGVybWl0dGVkIGJ5ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKS4gSW5jbHVkZSB7JHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXM6IFsuLi5dfSBpbiB0aGUgcmV0dXJuZWQgcGVybWl0LmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgcGFyZW50TGlua0F0dHJpYnV0ZXMgPSB0aGlzLl9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByZWxhdGlvbnNoaXA6IGNvbnRleHQucmVsYXRpb25zaGlwLFxuICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlc3Ryb3lFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHVwZGF0ZUVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgY3JlYXRlRW50cmllcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udGV4dC5lbnRyaWVzKSB7XG4gICAgICAgIGlmIChlbnRyeT8uX2Rlc3Ryb3kpIHtcbiAgICAgICAgICBpZiAoIWNvbnRleHQuZGVzdHJveVBlcm1pdHRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgcmVxdWVzdGVkIF9kZXN0cm95IGJ1dCBcIl9kZXN0cm95XCIgaXMgbm90IGluIHRoZSBwZXJtaXQgZm9yIHRoaXMgcmVsYXRpb25zaGlwLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZW50cnkuaWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVzdHJveUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfSBlbHNlIGlmIChlbnRyeT8uaWQpIHtcbiAgICAgICAgICB1cGRhdGVFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3JlYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZGVzdHJveUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLmRlc3Ryb3koZXhpc3RpbmcpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdXBkYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIHVwZGF0ZSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBwYXJlbnQsXG4gICAgICAgICAgcGFyZW50TGlua0F0dHJpYnV0ZXMsXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQ6IGV4aXN0aW5nLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgZXhpc3Rpbmcuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjcmVhdGVFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgY2hpbGQuYXNzaWduKHBhcmVudExpbmtBdHRyaWJ1dGVzKVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgb25lIG5lc3RlZCBlbnRyeSdzIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzIHRvIGEgY2hpbGQgbW9kZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzaWdubWVudCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCByZWNlaXZpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyAtIFBlcm1pdHRlZCBjaGlsZCBhdHRyaWJ1dGUgYW5kIGF0dGFjaG1lbnQgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmVudHJ5IC0gTmVzdGVkIGVudHJ5IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7Y2hpbGQsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLCBlbnRyeX0pIHtcbiAgICBpZiAoZW50cnkuYXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRyaWJ1dGVzIHRvIGJlIGFuIG9iamVjdC5cIilcblxuICAgICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKGNoaWxkLCBjaGlsZC5nZXRNb2RlbENsYXNzKCksIGVudHJ5LmF0dHJpYnV0ZXMsIHRoaXMsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKGNoaWxkLCBmaWx0ZXJlZClcbiAgICB9XG5cbiAgICBpZiAoZW50cnkuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCAmJiAhaXNQbGFpbk9iamVjdChlbnRyeS5hdHRhY2htZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMoY2hpbGQsIGVudHJ5LmF0dGFjaG1lbnRzID8/IG51bGwsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgcmVsYXRpb25zaGlwJ3MgZm9yZWlnbi1rZXkgY29sdW1uL25hbWUgdG8gdGhlIHRhcmdldCBtb2RlbCdzIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGNvbnRhaW5pbmcgdGhlIEZLLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JlaWduLWtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIF9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgIHJldHVybiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtmb3JlaWduS2V5XSB8fCBmb3JlaWduS2V5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgRksgYXR0cmlidXRlcyB0aGF0IGJpbmQgYSBuZXN0ZWQgY2hpbGQgdG8gaXRzIHBhcmVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYXJlbnQtbGluayBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IEF0dHJpYnV0ZXMgdGhhdCBzY29wZSB0aGUgY2hpbGQgdG8gdGhlIHBhcmVudC5cbiAgICovXG4gIF9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtwYXJlbnQsIHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHtbZm9yZWlnbktleV06IHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHBhcmVudC5pZCgpLCBgTmVzdGVkIGNoaWxkIHdyaXRlIGZvciAke3BhcmVudC5nZXRNb2RlbENsYXNzKCkubmFtZX1gKX1cblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSkge1xuICAgICAgY29uc3QgdHlwZUF0dHJpYnV0ZSA9IHRoaXMuX3BvbHltb3JwaGljVHlwZUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgYXR0cmlidXRlc1t0eXBlQXR0cmlidXRlXSA9IHBhcmVudC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgcmVsYXRpb25zaGlwJ3MgcG9seW1vcnBoaWMgdHlwZSBjb2x1bW4vbmFtZSB0byBhIGNoaWxkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGNvbnRhaW5pbmcgdGhlIHR5cGUgY29sdW1uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQb2x5bW9ycGhpYyB0eXBlIGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgX3BvbHltb3JwaGljVHlwZUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgbW9kZWxDbGFzcykge1xuICAgIGNvbnN0IHR5cGVDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWNUeXBlQ29sdW1uKClcblxuICAgIHJldHVybiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVt0eXBlQ29sdW1uXSB8fCB0eXBlQ29sdW1uXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYW4gYXV0aG9yaXplZCBuZXN0ZWQgcmVjb3JkIGJ5IGlkIHdpdGhvdXQgcGFyZW50IHNjb3BpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTG9va3VwIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5hYmlsaXR5IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge1widXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQXV0aG9yaXplZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kTmVzdGVkUmVjb3JkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSB8fCB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyB0YXJnZXRNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5fcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSwgYWJpbGl0eSlcbiAgICAgIDogdGFyZ2V0TW9kZWxDbGFzcy53aGVyZSh7fSlcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90ICR7YWN0aW9ufSBuZXN0ZWQgJHtyZWxhdGlvbnNoaXBOYW1lfVtpZD0ke2lkfV06IHJlY29yZCBub3QgZm91bmQgb3Igbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG5cbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWJpbGl0eSBhY3Rpb24gZm9yIGEgY2hpbGQgcmVzb3VyY2UgdXNpbmcgdGhlIGNoaWxkJ3Mgb3duXG4gICAqIGBhYmlsaXRpZXNgIG1hcHBpbmcg4oCUIG5ldmVyIHRoZSBwYXJlbnQgY29udHJvbGxlcidzLiBUaGlzIHByZXNlcnZlc1xuICAgKiBjdXN0b20gbWFwcGluZ3MgbGlrZSBge3VwZGF0ZTogXCJtYW5hZ2VcIn1gIGFuZCBjYXRjaGVzIHVubWFwcGVkIGFjdGlvbnNcbiAgICogaW5zdGVhZCBvZiBzaWxlbnRseSBkZWZhdWx0aW5nIHRvIHRoZSByYXcgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYmlsaXR5IGFjdGlvbiBmb3IgdGhlIGNoaWxkIHJlc291cmNlLlxuICAgKi9cbiAgX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uPy5hYmlsaXRpZXNcblxuICAgIGlmICghYWJpbGl0aWVzIHx8IHR5cGVvZiBhYmlsaXRpZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhbiAnYWJpbGl0aWVzJyBvYmplY3QgdG8gYXV0aG9yaXplIG5lc3RlZCAke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAoYWJpbGl0aWVzKVthY3Rpb25dXG5cbiAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhYmlsaXRpZXMuJHthY3Rpb259LmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBleGlzdGluZyBjaGlsZCBmb3IgYSBuZXN0ZWQgdXBkYXRlL2Rlc3Ryb3ksIHNjb3BlZCB0byB0aGVcbiAgICogY2hpbGQncyBvd24gbW9kZWwgY2xhc3MsIHRoZSBwYXJlbnQncyBmb3JlaWduIGtleSwgQU5EIHRoZSBjaGlsZFxuICAgKiByZXNvdXJjZSdzIGFiaWxpdHkgbWFwcGluZyBmb3IgdGhlIHJlcXVlc3RlZCBhY3Rpb24uIFRocm93cyB3aGVuIHRoZVxuICAgKiBjaGlsZCBkb2VzIG5vdCBleGlzdCwgZG9lcyBub3QgYmVsb25nIHRvIHRoZSBjdXJyZW50IHBhcmVudCwgb3IgaXNcbiAgICogbm90IGF1dGhvcml6ZWQg4oCUIGFsbCBvZiB3aGljaCBtdXN0IHJvbGwgdGhlIHRyYW5zYWN0aW9uIGJhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gYXJncy5pZCAtIENoaWxkIGlkIGZyb20gdGhlIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGFyZ3MucGFyZW50TGlua0F0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCwgcGFyZW50LWxpbmtlZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kU2NvcGVkQ2hpbGQoe2FiaWxpdHksIGFjdGlvbiwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGlkLCBwYXJlbnQsIHBhcmVudExpbmtBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5IHx8IHRhcmdldE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgbG9va3VwID0gey4uLm1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpLCAuLi5wYXJlbnRMaW5rQXR0cmlidXRlc31cbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShsb29rdXApXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kLCBkb2VzIG5vdCBiZWxvbmcgdG8gcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0sIG9yIGlzIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgYW4gYWxyZWFkeS1zYXZlZCBuZXN0ZWQgY2hpbGQgaXMgYXV0aG9yaXplZCB1bmRlciB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBvd24gYGNyZWF0ZWAgYWJpbGl0eS4gUm9sbHMgYmFjayB2aWEgdGhyb3duIGVycm9yIHdoZW4gbm90XG4gICAqIGF1dGhvcml6ZWQgc28gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGRlc3Ryb3lzIHRoZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCBpbnN0YW5jZSBqdXN0IGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe2FiaWxpdHksIGNoaWxkLCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIWFiaWxpdHkpIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkgfHwgdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBpZGVudGl0eSA9IHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gY2hpbGQucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgICBjb25zdCBhdXRob3JpemVkQ2hpbGQgPSBhd2FpdCB0YXJnZXRNb2RlbENsYXNzXG4gICAgICAuYWNjZXNzaWJsZUZvcihhYmlsaXR5QWN0aW9uLCBhYmlsaXR5KVxuICAgICAgLmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkZW50aXR5KSlcblxuICAgIGlmICghYXV0aG9yaXplZENoaWxkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjcmVhdGUgb24gJHtyZWxhdGlvbnNoaXBOYW1lfVske3RhcmdldE1vZGVsQ2xhc3MubmFtZX1dIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFmdGVyIG5lc3RlZCB3cml0ZXMsIHByZWxvYWQgZXZlcnkgcmVsYXRpb25zaGlwIGRlY2xhcmVkIGluIHRoZVxuICAgKiBwYXJlbnQncyBwZXJtaXQgc28gdGhlIHBvc3Qtc2F2ZSBzZXJpYWxpemUgc3RlcCBlbWl0cyB0aGVtIGFuZCB0aGVcbiAgICogY2xpZW50IGNhbiByZWNvbmNpbGUgaWRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIFNhdmVkIHBhcmVudCBtb2RlbC5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gcGVybWl0IC0gUGFyc2VkIHBhcmVudCBwZXJtaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3ByZWxvYWROZXN0ZWRXcml0YWJsZVJlbGF0aW9uc2hpcHMobW9kZWwsIHBlcm1pdCkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWVzID0gT2JqZWN0LmtleXMocGVybWl0Lm5lc3RlZClcblxuICAgIGlmIChyZWxhdGlvbnNoaXBOYW1lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHJlbGF0aW9uc2hpcE5hbWVzKSB7XG4gICAgICBhd2FpdCBtb2RlbC5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUGFyc2VzIHRoZSBSYWlscy9hcGlfbWFrZXItc3R5bGUgZmxhdCBwZXJtaXQgc3BlYyByZXR1cm5lZCBmcm9tXG4gKiBgcGVybWl0dGVkUGFyYW1zKGFyZylgIGludG8gYSBzdHJ1Y3R1cmVkIHNoYXBlIHVzZWQgaW50ZXJuYWxseSBieSB0aGVcbiAqIHdyaXRlIHBpcGVsaW5lLiBTdHJpbmdzIGJlY29tZSBhdHRyaWJ1dGUgcGVybWl0czsgb2JqZWN0cyB3aG9zZSBrZXlzXG4gKiBlbmQgaW4gYEF0dHJpYnV0ZXNgIGJlY29tZSBuZXN0ZWQgcGVybWl0cyAodGhlIGtleSBwcmVmaXggbmFtZXMgdGhlXG4gKiByZWxhdGlvbnNoaXApLlxuICpcbiAqICAgcGFyc2VQZXJtaXR0ZWRQYXJhbXMoW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIixcbiAqICAgICB7dGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAqICAgXSlcbiAqICAgLy8g4oaSIHtcbiAqICAgLy8gICBhdHRyaWJ1dGVzOiBbXCJmaXJzdE5hbWVcIiwgXCJsYXN0TmFtZVwiXSxcbiAqICAgLy8gICBuZXN0ZWQ6IHtcbiAqICAgLy8gICAgIHRhc2tzOiB7YXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl0sIG5lc3RlZDoge319XG4gKiAgIC8vICAgfVxuICogICAvLyB9XG4gKiBAcGFyYW0ge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4gfCB1bmRlZmluZWR9IHBlcm1pdFNwZWMgLSBGbGF0IHBlcm1pdCBzcGVjLlxuICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCB7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59fSAtIFBhcnNlZCBzdHJ1Y3R1cmUuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUGVybWl0dGVkUGFyYW1zKHBlcm1pdFNwZWMpIHtcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgYXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICBjb25zdCBuZXN0ZWQgPSB7fVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShwZXJtaXRTcGVjKSkgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBwZXJtaXRTcGVjKSB7XG4gICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgYXR0cmlidXRlcy5wdXNoKGVudHJ5KVxuICAgIH0gZWxzZSBpZiAoZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGVudHJ5KSkge1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZW50cnkpKSB7XG4gICAgICAgIGlmICgha2V5LmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IG5lc3RlZCByZWxhdGlvbnNoaXAga2V5cyBtdXN0IGVuZCBpbiBcIkF0dHJpYnV0ZXNcIiAoZ290IFwiJHtrZXl9XCIpLiBVc2UgXCIke2tleX1BdHRyaWJ1dGVzXCIgaW5zdGVhZC5gKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBrZXkuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcblxuICAgICAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBlbXB0eSByZWxhdGlvbnNoaXAgbmFtZSBpbiBrZXkgXCIke2tleX1cIi5gKVxuICAgICAgICB9XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5IGZvciBcIiR7a2V5fVwiOiBleHBlY3RlZCBhcnJheSBwZXJtaXQgc3BlYywgZ290ICR7dHlwZW9mIHZhbHVlfS5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModmFsdWUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IGV4cGVjdGVkIHN0cmluZyBvciBuZXN0ZWQtYXR0cmlidXRlcyBvYmplY3QsIGdvdCAke3R5cGVvZiBlbnRyeX0uYClcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge2F0dHJpYnV0ZXMsIG5lc3RlZH1cbn1cblxuLyoqXG4gKiBMb2NhdGVzIHdoaWNoIHByb3RvdHlwZSBvd25zIGEgbWV0aG9kIGltcGxlbWVudGF0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGluc3RhbmNlIC0gSW5zdGFuY2UgcmVjZWl2aW5nIHRoZSBtZXRob2QuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICogQHJldHVybnMge29iamVjdCB8IG51bGx9IC0gUHJvdG90eXBlIHRoYXQgb3ducyB0aGUgbWV0aG9kLlxuICovXG5mdW5jdGlvbiBwcm90b3R5cGVPd25lckZvck1ldGhvZChpbnN0YW5jZSwgbWV0aG9kTmFtZSkge1xuICBsZXQgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGluc3RhbmNlKVxuXG4gIHdoaWxlIChwcm90b3R5cGUpIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHByb3RvdHlwZSwgbWV0aG9kTmFtZSkpIHJldHVybiBwcm90b3R5cGVcblxuICAgIHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90b3R5cGUpXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIFJ1bnMgZmlsdGVyIHdyaXRhYmxlIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFJlc291cmNlTW9kZWxDbGFzc1xuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVjZWl2ZXIgLSBNb2RlbCBpbnN0YW5jZSBvciBwcm90b3R5cGUuXG4gKiBAcGFyYW0ge1dyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc30gcmVjZWl2ZXJDbGFzcyAtIFN0YXRpYyBoZWxwZXIgb3duZXIgZm9yIHRoZSByZWNlaXZlci5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxSZXNvdXJjZU1vZGVsQ2xhc3MsIFJlc291cmNlRGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9IFtyZXNvdXJjZV0gLSBSZXNvdXJjZSBpbnN0YW5jZSBmb3IgdmlydHVhbC1zZXR0ZXIgZGV0ZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmdbXSB8IG51bGx9IFtwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lc10gLSBPcHRpb25hbCBleHBsaWNpdCBwZXJtaXQgbGlzdC4gYG51bGxgIGZhbGxzIGJhY2sgdG8gc2V0dGVyLWV4aXN0ZW5jZSBjaGVja3Mgb25seS5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gV3JpdGFibGUgYXR0cmlidXRlcyBvbmx5LlxuICovXG5mdW5jdGlvbiBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKFxuICByZWNlaXZlcixcbiAgcmVjZWl2ZXJDbGFzcyxcbiAgYXR0cmlidXRlcyxcbiAgcmVzb3VyY2UgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8UmVzb3VyY2VNb2RlbENsYXNzLCBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsfSAqLyAobnVsbCksXG4gIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzID0gbnVsbFxuKSB7XG4gIC8vIEZyb250ZW5kLW1vZGVsIHdyaXRlcyBzaG91bGQgZmFpbCBmYXN0IHdoZW4gY2FsbGVycyBzdWJtaXQgcmVhZC1vbmx5IG9yIHVua25vd24gYXR0cnMuXG4gIC8vIFNpbGVudCBkcm9wcyBoaWRlIGNvbnRyYWN0IG1pc3Rha2VzIGluIGdlbmVyYXRlZCBtb2RlbHMgYW5kIGFwcC1zaWRlIHdyYXBwZXIgY29kZS5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHdyaXRhYmxlQXR0cmlidXRlcyA9IHt9XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGludmFsaWRBdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3Qgbm90UGVybWl0dGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgY29uc3QgcGVybWl0U2V0ID0gQXJyYXkuaXNBcnJheShwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgPyBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSA6IG51bGxcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgbGV0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gW11cblxuICBpZiAocmVzb3VyY2UpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHJlc291cmNlLmNvbnN0cnVjdG9yKVxuXG4gICAgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSBSZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW11cbiAgfVxuXG4gIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KHRyYW5zbGF0ZWRBdHRyaWJ1dGVzKVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgIGlmIChwZXJtaXRTZXQgJiYgIXBlcm1pdFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSByZWNlaXZlckNsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHx8IGF0dHJpYnV0ZU5hbWVcbiAgICBjb25zdCByZXF1ZXN0ZWRTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpfWBcbiAgICBjb25zdCBzZXR0ZXJOYW1lID0gcmVjZWl2ZXJDbGFzcy5maW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlKHJlY2VpdmVyLCByZXF1ZXN0ZWRTZXR0ZXJOYW1lKSB8fCByZXF1ZXN0ZWRTZXR0ZXJOYW1lXG4gICAgY29uc3QgcmVzb3VyY2VTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX1BdHRyaWJ1dGVgXG4gICAgY29uc3QgcmVzb3VyY2VTZXR0ZXIgPSByZXNvdXJjZT8ucmVzb3VyY2VNZXRob2QocmVzb3VyY2VTZXR0ZXJOYW1lKVxuXG4gICAgaWYgKHNldHRlck5hbWUgaW4gcmVjZWl2ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmIChyZXNvdXJjZVNldHRlcikge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBpbnZhbGlkQXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICB9XG5cbiAgaWYgKG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gIH1cblxuICBpZiAoaW52YWxpZEF0dHJpYnV0ZXMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgd3JpdGUgYXR0cmlidXRlczogJHtpbnZhbGlkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgcmV0dXJuIHdyaXRhYmxlQXR0cmlidXRlc1xufVxuIl19