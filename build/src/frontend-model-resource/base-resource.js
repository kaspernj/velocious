// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import * as inflection from "inflection";
import isPlainObject from "../utils/plain-object.js";
import VelociousError from "../velocious-error.js";
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
 * @typedef {FrontendModelResourceAttributePayload & {id?: string | number, _destroy?: boolean, attributes?: FrontendModelResourceAttributePayload, attachments?: FrontendModelResourceAttributePayload, nestedAttributes?: FrontendModelResourceAttributePayload}} FrontendModelResourceNestedEntry
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
    /** @type {string | undefined} */
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
            config.primaryKey = /** @type {string} */ (primaryKey);
        if (relationships)
            config.relationships = /** @type {string[]} */ (relationships);
        if (server)
            config.server = /** @type {import("../configuration-types.js").FrontendModelResourceServerConfiguration} */ (server);
        if (sync !== undefined)
            config.sync = /** @type {import("../configuration-types.js").FrontendModelResourceSyncConfiguration | boolean} */ (sync);
        return config;
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
        const primaryKey = ModelClass.primaryKey();
        const query = ability
            ? ModelClass.accessibleFor(this.syncAbilityAction(forDelete ? "destroy" : "update"), ability)
            : ModelClass.where({});
        return await query.findBy({ [primaryKey]: mutation.resourceId });
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
     * @returns {string} - Primary key.
     */
    primaryKey() { return this.modelClass().primaryKey(); }
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
     * @param {string | number} id - Record id.
     * @returns {Promise<import("../database/record/index.js").default | null>} - Located model.
     */
    async find(action, id) {
        let query = this.authorizedQuery(action);
        const preload = action === "find" ? this.typedControllerInstance().frontendModelPreload() : null;
        if (preload) {
            query = query.preload(preload);
        }
        return await query.findBy({ [this.primaryKey()]: id });
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
            .map((entry) => this._normalizeNestedRelationshipEntry({ childPermit, entry, relationshipName, targetModelClass }))
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
     * @param {FrontendModelResourceNestedEntry} args.entry - Raw nested entry.
     * @param {string} args.relationshipName - Relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {FrontendModelResourceNestedEntry} Normalized nested entry.
     */
    _normalizeNestedRelationshipEntry({ childPermit, entry, relationshipName, targetModelClass }) {
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
                if (typeof value !== "string" && typeof value !== "number") {
                    throw new Error(`nestedAttributes['${relationshipName}'] entry id must be a string or number.`);
                }
                normalized.id = value;
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
                parent.setAttribute(foreignKey, child.id());
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
        const attributes = { [foreignKey]: /** @type {string | number} */ (parent.id()) };
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
     * @param {string | number} args.id - Child id from the payload.
     * @param {string} args.relationshipName - Parent's relationship name for error messages.
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} Authorized child model.
     */
    async _findNestedRecord({ ability, action, childResourceConfiguration, id, relationshipName, targetModelClass }) {
        const primaryKey = targetModelClass.primaryKey();
        const query = ability
            ? targetModelClass.accessibleFor(this._resolveChildAbilityAction(childResourceConfiguration, action), ability)
            : targetModelClass.where({});
        const existing = await query.findBy({ [primaryKey]: id });
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
     * @param {string | number} args.id - Child id from the payload.
     * @param {import("../database/record/index.js").default} args.parent - Parent model instance.
     * @param {Record<string, string | number>} args.parentLinkAttributes - Attributes that scope the child to the parent.
     * @param {string} args.relationshipName - Parent's relationship name (for error messages).
     * @param {typeof import("../database/record/index.js").default} args.targetModelClass - Child model class.
     * @returns {Promise<import("../database/record/index.js").default>} - Authorized, parent-linked child model.
     */
    async _findScopedChild({ ability, action, childResourceConfiguration, id, parent, parentLinkAttributes, relationshipName, targetModelClass }) {
        const primaryKey = targetModelClass.primaryKey();
        const lookup = { [primaryKey]: id, ...parentLinkAttributes };
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
        const primaryKey = targetModelClass.primaryKey();
        const authorizedIds = await targetModelClass
            .accessibleFor(abilityAction, ability)
            .where({ [primaryKey]: child.readAttribute(primaryKey) })
            .pluck(primaryKey);
        if (authorizedIds.length === 0) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7Ozs7R0FTRztBQUVIOzs7Ozs7Ozs7Ozs7R0FZRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7OztHQUtHO0FBRUg7OztHQUdHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUNILE1BQU0sVUFBVSx3Q0FBd0MsQ0FBQyxhQUFhO0lBQ3BFLE9BQU8sbUtBQW1LLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFBO0FBQ3JOLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBMEIsU0FBUSx5QkFBeUI7SUFDOUUsMERBQTBEO0lBQzFELE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRTdCLG1GQUFtRjtJQUNuRixNQUFNLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtJQUM3Qixt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QUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsNENBQTRDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtJQUNqSixDQUFDO0lBRUQsT0FBTyxrQkFBa0IsQ0FBQTtBQUMzQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBCYWNrZW5kIG9yIGZyb250ZW5kIG1vZGVsIGNsYXNzIGJvdW5kIHRvIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCIpLkF1dGhvcml6YXRpb25SZXNvdXJjZU1vZGVsQ2xhc3MgJiB7YXR0YWNobWVudERlZmluaXRpb25zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4sIHByaW1hcnlLZXk6ICgpID0+IHN0cmluZ319IEZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3NcbiAqL1xuXG4vKipcbiAqIEJ1aWx0LWluIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGFjdGlvbi5cbiAqIEB0eXBlZGVmIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIG1ldGhvZHMgdXNlZCBieSByZXNvdXJjZXMuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0ICYge1xuICogICBjdXJyZW50QWJpbGl0eTogKCkgPT4gaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFBhZ2luYXRpb246IChhcmdzOiB7cGFnaW5hdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbiwgcXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0pID0+IHZvaWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaDogKGFyZ3M6IHtxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LCBzZWFyY2g6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0pID0+IHZvaWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFNvcnQ6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc29ydDogRnJvbnRlbmRNb2RlbFJlc291cmNlU29ydH0pID0+IHZvaWQsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QWN0aW9uOiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IHN0cmluZyxcbiAqICAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnk6IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbikgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEluZGV4UXVlcnk6IChvcHRpb25zPzogRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnMgJiB7cmVzb3VyY2U/OiBQaWNrPEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4sIFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydFwiPn0pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbFBhcmFtczogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMsXG4gKiAgIGZyb250ZW5kTW9kZWxQcmVsb2FkOiAoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbCxcbiAqICAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3M6IChtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGwsXG4gKiAgIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWw6IChtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgb2JqZWN0IHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+PlxuICogfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlclxuICovXG5cbi8qKlxuICogR2VuZXJpYyBmcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeSBwYXNzZWQgdG8gcmVzb3VyY2UgcXVlcnkgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBpbmRleCBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyB0eXBlLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPXR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdF1cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGNvbnRyb2xsZXIgLSBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIGluc3RhbmNlLlxuICogQHByb3BlcnR5IHtURGF0YWJhc2VNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbiAob3IgcmF3IGlucHV0IHNoYXBlIGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3MgdHlwZS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gW1RNb2RlbENsYXNzPUZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3NdXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnc1xuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZSB3aGVuIHRoZSByZXNvdXJjZSBpcyB1c2VkIGRpcmVjdGx5IGZvciBhdXRob3JpemF0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyLWxlc3MgY29uc3RydWN0aW9uIChmb3IgZXhhbXBsZSB0aGUgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCk7IHRoZSBjb250cm9sbGVyIHBhdGggZGVyaXZlcyBpdCBmcm9tIHRoZSBjb250cm9sbGVyIGluc3RlYWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtjb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2xvY2Fsc10gLSBBYmlsaXR5IGxvY2Fscy5cbiAqIEBwcm9wZXJ0eSB7VE1vZGVsQ2xhc3N9IFttb2RlbENsYXNzXSAtIE9wdGlvbmFsIGJhY2tpbmcgbW9kZWwgY2xhc3Mgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW21vZGVsTmFtZV0gLSBPcHRpb25hbCBtb2RlbCBuYW1lIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gW3BhcmFtc10gLSBPcHRpb25hbCBwYXJhbXMgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IFtyZXNvdXJjZUNvbmZpZ3VyYXRpb25dIC0gT3B0aW9uYWwgbm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogSW50ZXJuYWwgY29uc3RydWN0b3IgY29udHJhY3QgdXNlZCB3aGVuIGEgcmVzb3VyY2UgaW5zdGFudGlhdGVzIGl0cyBzaGFyZWRcbiAqIGNvdW50ZXJwYXJ0IGFjcm9zcyB0aGUgZnJvbnRlbmQvYmFja2VuZCBtb2RlbCBib3VuZGFyeS5cbiAqIEB0ZW1wbGF0ZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzc30gVE1vZGVsQ2xhc3NcbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBURGF0YWJhc2VNb2RlbENsYXNzXG4gKiBAdHlwZWRlZiB7e25ldyAoYXJnczogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3M8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4gfCBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyk6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fX0gRnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvclxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBwYXNzZWQgdG8gdGhlIHJlc291cmNlIHN5bmMgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vc3luYy9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gRnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvblxuICovXG5cbi8qKlxuICogU3luYyBtdXRhdGlvbiBhdXRob3JpemF0aW9uIHJlc3VsdC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvblxuICogQHByb3BlcnR5IHtib29sZWFufSBhbGxvd2VkIC0gV2hldGhlciB0aGUgbXV0YXRpb24gbWF5IGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3JlYXNvbl0gLSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSB3aGVuIGRlbmllZC5cbiAqL1xuXG4vKipcbiAqIEFyZ3VtZW50cyBmb3IgdGhlIGFwcGx5U3luYyBmdWxsLWVzY2FwZS1oYXRjaCBob29rLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3NcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gZXhpc3RpbmdTeW5jIC0gRXhpc3Rpbmcgc3luYyByb3cgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAqL1xuXG4vKipcbiAqIEFwcGx5IHJlc3VsdCBwcm9kdWNlZCBieSByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY3JlYXRlZCAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGNyZWF0ZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWxldGVkXSAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGRlbGV0ZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gcmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAqL1xuXG4vKipcbiAqIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdHJhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3Qgb3duaW5nIHRoZSByZXNvdXJjZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gcmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cblxuLyoqXG4gKiBUcmFuc3BvcnQtc2FmZSB2YWx1ZSBhY2NlcHRlZCBpbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbiBwYXlsb2Fkcy5cbiAqIE5lc3RlZCBvYmplY3QvYXJyYXkgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0c1xuICogcmVjdXJzaXZlIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCBwYXlsb2FkIGNvbnRyYWN0LlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlXG4gKi9cblxuLyoqXG4gKiBBdHRyaWJ1dGUgcGF5bG9hZCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbnMuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZFxuICovXG5cbi8qKlxuICogVmlydHVhbCBzZXR0ZXIgbWV0aG9kIG9uIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7KGFyZzE6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBhcmcyOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWUpID0+ICh2b2lkIHwgUHJvbWlzZTx2b2lkPil9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVZpcnR1YWxTZXR0ZXJcbiAqL1xuXG4vKipcbiAqIFN0YXRpYyBoZWxwZXJzIHVzZWQgd2hlbiBjaGVja2luZyB3aGV0aGVyIGEgbW9kZWwtbGlrZSByZWNlaXZlciBhY2NlcHRzIGFuIGF0dHJpYnV0ZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc1xuICogQHByb3BlcnR5IHsoYXJnOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IHJlc29sdmVBdHRyaWJ1dGVOYW1lIC0gUmVzb2x2ZXMgYWxpYXNlcyB0byBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWVzLlxuICogQHByb3BlcnR5IHsoYXJnMTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhcmcyOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUgLSBMb2NhdGVzIGEgc2V0dGVyIG1ldGhvZCBvbiB0aGUgcmVjZWl2ZXIuXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIHBhc3NlZCB3aGlsZSBzYXZpbmcgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFthdHRhY2htZW50c10gLSBVcGxvYWRlZCBhdHRhY2htZW50IGF0dHJpYnV0ZXMuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsfSBbY29udHJvbGxlcl0gLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBtdXRhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFtuZXN0ZWRBdHRyaWJ1dGVzXSAtIE5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cblxuLyoqXG4gKiBOb3JtYWxpemVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgJiB7aWQ/OiBzdHJpbmcgfCBudW1iZXIsIF9kZXN0cm95PzogYm9vbGVhbiwgYXR0cmlidXRlcz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQsIGF0dGFjaG1lbnRzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCwgbmVzdGVkQXR0cmlidXRlcz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeVxuICovXG5cbi8qKlxuICogTmFycm93cyBhbiB1bmJvdW5kIHJlc291cmNlIHJlZ2lzdHJ5IGVudHJ5IGF0IGZyYW1ld29yay1vd25lZCBjb25zdHJ1Y3Rpb25cbiAqIHNpdGVzIHdoZXJlIHRoZSBiYWNraW5nIGRhdGFiYXNlIG1vZGVsIGhhcyBhbHJlYWR5IGJlZW4gcmVzb2x2ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSBSZXNvdXJjZUNsYXNzIC0gVW5ib3VuZCByZXNvdXJjZSBjbGFzcy5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gUnVudGltZSBjb25zdHJ1Y3Rvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoUmVzb3VyY2VDbGFzcykge1xuICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yPHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKFJlc291cmNlQ2xhc3MpKVxufVxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tlbmQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBbVE1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPUV4dHJhY3Q8VE1vZGVsQ2xhc3MsIHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD5dXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZXh0ZW5kcyBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHtcbiAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhYmlsaXRpZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRhY2htZW50cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbWVtYmVyQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHByaW1hcnlLZXkgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlcnZlckNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBzZXJ2ZXIgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgYm9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHN5bmMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gIHN0YXRpYyBTaGFyZWRSZXNvdXJjZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEZWNsYXJhdGl2ZSB3cml0YWJsZS1hdHRyaWJ1dGUgcGVybWl0IGxpc3QgKGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZXMpXG4gICAqIHVzZWQgYXMgdGhlIGRlZmF1bHQge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UjcGVybWl0dGVkUGFyYW1zfSBhbmRcbiAgICogYXMgdGhlIHJvdXRlZCBzeW5jIHJlcGxheSBwZXJtaXQuIFJlc29sdmVkIHRocm91Z2ggdGhlIHNoYXJlZCByZXNvdXJjZVxuICAgKiBsaWtlIHRoZSBvdGhlciBzdGF0aWMgcmVzb3VyY2UgY29uZmlnOiBhbiB1bmRlY2xhcmVkIGVudmlyb25tZW50IGxpc3RcbiAgICogZmFsbHMgYmFjayB0byB0aGUgc2hhcmVkIHJlc291cmNlJ3MgbGlzdCwgd2hpbGUgYW4gZXhwbGljaXQgZGVjbGFyYXRpb25cbiAgICogKGluY2x1ZGluZyBgbnVsbGApIHdpbnMuXG4gICAqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyB3cml0YWJsZUF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnczxUTW9kZWxDbGFzcz4gfCBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJnczxURGF0YWJhc2VNb2RlbENsYXNzPn0gYXJncyAtIFJlc291cmNlIGFyZ3MuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzKSB7XG4gICAgc3VwZXIoe1xuICAgICAgYWJpbGl0eTogXCJhYmlsaXR5XCIgaW4gYXJncyA/IGFyZ3MuYWJpbGl0eSA6IHVuZGVmaW5lZCxcbiAgICAgIGNvbnRleHQ6IFwiY29udGV4dFwiIGluIGFyZ3MgPyBhcmdzLmNvbnRleHQgfHwge30gOiB7fSxcbiAgICAgIGxvY2FsczogXCJsb2NhbHNcIiBpbiBhcmdzID8gYXJncy5sb2NhbHMgfHwge30gOiB7fVxuICAgIH0pXG5cbiAgICAvLyBOYXJyb3dzIHRoZSBzdWJjbGFzcyBzdGF0aWMgc2lkZSB0byB0aGUgbW9kZWwgY2xhc3MgY2FycmllZCBieSB0aGlzIHJlc291cmNlIGdlbmVyaWMuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgJiB7TW9kZWxDbGFzczogVE1vZGVsQ2xhc3MgfCB1bmRlZmluZWQsIG1vZGVsQ2xhc3M6ICgpID0+IFRNb2RlbENsYXNzfX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgZGVmYXVsdFJlc291cmNlQ29uZmlndXJhdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqLyAoe2F0dHJpYnV0ZXM6IFtdfSlcblxuICAgIHRoaXMuY29udHJvbGxlciA9IFwiY29udHJvbGxlclwiIGluIGFyZ3MgPyBhcmdzLmNvbnRyb2xsZXIgOiB1bmRlZmluZWRcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZSA9IFwiY29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLmNvbmZpZ3VyYXRpb24gOiB1bmRlZmluZWRcbiAgICAvLyBOYXJyb3dzIHRoZSBpbnRlcm5hbCBjb250cm9sbGVyL3NoYXJlZC1yZXNvdXJjZSBjb25zdHJ1Y3Rpb24gcGF0aCB0byB0aGUgcmVzb3VyY2UncyBkZWNsYXJlZCBtb2RlbCBnZW5lcmljLlxuICAgIHRoaXMubW9kZWxDbGFzc1ZhbHVlID0gLyoqIEB0eXBlIHtUTW9kZWxDbGFzc30gKi8gKFwibW9kZWxDbGFzc1wiIGluIGFyZ3MgPyBhcmdzLm1vZGVsQ2xhc3MgOiBSZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKSlcbiAgICB0aGlzLm1vZGVsTmFtZVZhbHVlID0gXCJtb2RlbE5hbWVcIiBpbiBhcmdzID8gYXJncy5tb2RlbE5hbWUgOiB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIHRoaXMucGFyYW1zVmFsdWUgPSBcInBhcmFtc1wiIGluIGFyZ3MgPyBhcmdzLnBhcmFtcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUgPSBcInJlc291cmNlQ29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLnJlc291cmNlQ29uZmlndXJhdGlvbiA6IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbmZpZ3VyZWQgc2hhcmVkIHJlc291cmNlIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gU2hhcmVkIHJlc291cmNlIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIHNoYXJlZFJlc291cmNlQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuU2hhcmVkUmVzb3VyY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIHN0YXRpYyByZXNvdXJjZSBjb25maWcgdmFsdWUgZnJvbSB0aGUgZW52aXJvbm1lbnQgcmVzb3VyY2UgZmlyc3QsXG4gICAqIHRoZW4gZnJvbSB0aGUgc2hhcmVkIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge1wiYWJpbGl0aWVzXCIgfCBcImF0dGFjaG1lbnRzXCIgfCBcImF0dHJpYnV0ZXNcIiB8IFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiIHwgXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIiB8IFwiY29sbGVjdGlvbkNvbW1hbmRzXCIgfCBcImNvbW1hbmRzXCIgfCBcIm1lbWJlckNvbW1hbmRzXCIgfCBcIm1vZGVsTmFtZVwiIHwgXCJwcmltYXJ5S2V5XCIgfCBcInJlbGF0aW9uc2hpcHNcIiB8IFwic2VydmVyXCIgfCBcInN5bmNcIiB8IFwidHJhbnNsYXRlZEF0dHJpYnV0ZXNcIiB8IFwid3JpdGFibGVBdHRyaWJ1dGVzXCJ9IG5hbWUgLSBTdGF0aWMgY29uZmlnIHByb3BlcnR5IG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBSZXNvbHZlZCBjb25maWcgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShuYW1lKSB7XG4gICAgaWYgKHRoaXNbbmFtZV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXNbbmFtZV1cblxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VDbGFzcygpKVxuXG4gICAgaWYgKCFTaGFyZWRSZXNvdXJjZSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGlmIChTaGFyZWRSZXNvdXJjZVtuYW1lXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gU2hhcmVkUmVzb3VyY2VbbmFtZV1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0cmFuc2xhdGVkIGF0dHJpYnV0ZXMgZnJvbSBlbnZpcm9ubWVudCBhbmQgc2hhcmVkIHJlc291cmNlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAtIFRyYW5zbGF0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwidHJhbnNsYXRlZEF0dHJpYnV0ZXNcIikpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZnJvbnRlbmQtc2FmZSBhdHRhY2htZW50IGRlY2xhcmF0aW9ucyBmcm9tIHRoZSBiYWNraW5nIG1vZGVsLlxuICAgKiBSZXNvdXJjZS1sZXZlbCBkZWNsYXJhdGlvbnMgcmVtYWluIGFzIGEgZmFsbGJhY2sgZm9yIGZyb250ZW5kLW9ubHkgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+fSAtIENsaWVudCBhdHRhY2htZW50IGNvbmZpZ3VyYXRpb24ga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50Q29uZmlndXJhdGlvbnMoKSB7XG4gICAgY29uc3QgY29uZmlndXJlZEF0dGFjaG1lbnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhdHRhY2htZW50c1wiKSlcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IGNvbmZpZ3VyZWRBdHRhY2htZW50cyA/IHsuLi5jb25maWd1cmVkQXR0YWNobWVudHN9IDoge31cblxuICAgIGlmICghdGhpcy5Nb2RlbENsYXNzKSByZXR1cm4gYXR0YWNobWVudHNcblxuICAgIGZvciAoY29uc3QgW2F0dGFjaG1lbnROYW1lLCBkZWZpbml0aW9uXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLk1vZGVsQ2xhc3MuYXR0YWNobWVudERlZmluaXRpb25zKCkpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50Q29uZmlnID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbn0gKi8gKHt0eXBlOiBkZWZpbml0aW9uLnR5cGV9KVxuXG4gICAgICBpZiAoZGVmaW5pdGlvbi5zeW5jKSBhdHRhY2htZW50Q29uZmlnLnN5bmMgPSB7Li4uZGVmaW5pdGlvbi5zeW5jfVxuXG4gICAgICBhdHRhY2htZW50c1thdHRhY2htZW50TmFtZV0gPSBhdHRhY2htZW50Q29uZmlnXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dGFjaG1lbnRzXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgcmVzb3VyY2UgaW5zdGFuY2UgZm9yIHNoYXJlZC1yZXNvdXJjZSBmYWxsYmFjayBjYWxscy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbH0gLSBTaGFyZWQgcmVzb3VyY2UgaW5zdGFuY2Ugd2hlbiBjb25maWd1cmVkLlxuICAgKi9cbiAgc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpIHtcbiAgICBpZiAodGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG5cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz4gfCB1bmRlZmluZWR9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlQ2xhc3MoKSlcblxuICAgIGlmICghU2hhcmVkUmVzb3VyY2UpIHtcbiAgICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gbnVsbFxuICAgICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG4gICAgfVxuXG4gICAgaWYgKFNoYXJlZFJlc291cmNlID09PSBSZXNvdXJjZUNsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7UmVzb3VyY2VDbGFzcy5uYW1lfS5TaGFyZWRSZXNvdXJjZSBjYW5ub3QgcG9pbnQgdG8gaXRzZWxmLmApXG4gICAgfVxuXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2VDb25zdHJ1Y3RvciA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcjxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChTaGFyZWRSZXNvdXJjZSkpXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSBuZXcgU2hhcmVkUmVzb3VyY2VDb25zdHJ1Y3Rvcih7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyOiB0aGlzLmNvbnRyb2xsZXIsXG4gICAgICBjb250ZXh0OiB0aGlzLmNvbnRleHQsXG4gICAgICBsb2NhbHM6IHRoaXMubG9jYWxzLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IHRoaXMubW9kZWxOYW1lKCksXG4gICAgICBwYXJhbXM6IHRoaXMucGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKClcbiAgICB9KVxuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gc2hhcmVkUmVzb3VyY2VcblxuICAgIHJldHVybiBzaGFyZWRSZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxzIGEgc2hhcmVkLXJlc291cmNlIG1ldGhvZCBvbmx5IHdoZW4gdGhlIHNoYXJlZCByZXNvdXJjZSBvdmVycmlkZXMgdGhlIGZyYW1ld29yayBkZWZhdWx0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEBwYXJhbSB7dW5rbm93bltdfSBhcmdzIC0gTWV0aG9kIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt7Y2FsbGVkOiBib29sZWFuLCByZXN1bHQ6IHVua25vd259fSAtIFNoYXJlZCBtZXRob2QgY2FsbCByZXN1bHQuXG4gICAqL1xuICBjYWxsU2hhcmVkUmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSwgYXJncykge1xuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlKClcblxuICAgIGlmICghc2hhcmVkUmVzb3VyY2UpIHJldHVybiB7Y2FsbGVkOiBmYWxzZSwgcmVzdWx0OiB1bmRlZmluZWR9XG5cbiAgICBjb25zdCBtZXRob2RPd25lciA9IHByb3RvdHlwZU93bmVyRm9yTWV0aG9kKHNoYXJlZFJlc291cmNlLCBtZXRob2ROYW1lKVxuXG4gICAgaWYgKCFtZXRob2RPd25lciB8fCBtZXRob2RPd25lciA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUgfHwgbWV0aG9kT3duZXIgPT09IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UucHJvdG90eXBlKSB7XG4gICAgICByZXR1cm4ge2NhbGxlZDogZmFsc2UsIHJlc3VsdDogdW5kZWZpbmVkfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzaGFyZWRSZXNvdXJjZSkpW21ldGhvZE5hbWVdXG5cbiAgICByZXR1cm4ge2NhbGxlZDogdHJ1ZSwgcmVzdWx0OiBtZXRob2QuYXBwbHkoc2hhcmVkUmVzb3VyY2UsIGFyZ3MpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2hhcmVkIG1ldGhvZCByZXN1bHQgb3IgYSBmYWxsYmFjayBjYWxsYmFjay5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIFNoYXJlZCBtZXRob2QgbmFtZS5cbiAgICogQHBhcmFtIHt1bmtub3duW119IGFyZ3MgLSBTaGFyZWQgbWV0aG9kIGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUmVzdWx0fSBmYWxsYmFjayAtIEZhbGxiYWNrIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UmVzdWx0fSAtIFNoYXJlZCBvciBmYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBzaGFyZWRSZXNvdXJjZU1ldGhvZE9yKG1ldGhvZE5hbWUsIGFyZ3MsIGZhbGxiYWNrKSB7XG4gICAgY29uc3Qgc2hhcmVkUmVzdWx0ID0gdGhpcy5jYWxsU2hhcmVkUmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSwgYXJncylcblxuICAgIGlmIChzaGFyZWRSZXN1bHQuY2FsbGVkKSByZXR1cm4gLyoqIEB0eXBlIHtSZXN1bHR9ICovIChzaGFyZWRSZXN1bHQucmVzdWx0KVxuXG4gICAgcmV0dXJuIGZhbGxiYWNrKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIG1ldGhvZCBvbiB0aGlzIHJlc291cmNlIG9yIGl0cyBzaGFyZWQgZmFsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7bWV0aG9kOiAoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3duLCByZXNvdXJjZTogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZTxUTW9kZWxDbGFzcywgVERhdGFiYXNlTW9kZWxDbGFzcz59IHwgbnVsbH0gLSBSZXNvbHZlZCBtZXRob2QgYW5kIHJlY2VpdmVyLlxuICAgKi9cbiAgcmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSkge1xuICAgIGNvbnN0IG93bk1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKSlbbWV0aG9kTmFtZV1cblxuICAgIGlmICh0eXBlb2Ygb3duTWV0aG9kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAob3duTWV0aG9kKSxcbiAgICAgICAgcmVzb3VyY2U6IHRoaXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoIXNoYXJlZFJlc291cmNlKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc2hhcmVkTWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIGlmICh0eXBlb2Ygc2hhcmVkTWV0aG9kICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWV0aG9kOiAvKiogQHR5cGUgeyguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd259ICovIChzaGFyZWRNZXRob2QpLFxuICAgICAgcmVzb3VyY2U6IHNoYXJlZFJlc291cmNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0aWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhYmlsaXRpZXMoKSB7XG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWJpbGl0aWVzXCIsIFtdLCAoKSA9PiB1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0eXBlZCBjb250cm9sbGVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gLSBDb250cm9sbGVyIGluc3RhbmNlIHdpdGggZnJvbnRlbmQtbW9kZWwgaGVscGVycy5cbiAgICovXG4gIHR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9ICovICh0aGlzLmNvbnRyb2xsZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IC0gU3RhdGljIHJlc291cmNlIGNvbmZpZyAocmF3IHVzZXIgaW5wdXQgc2hhcGU7IGNvbnN1bWVycyBub3JtYWxpemUpLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhdHRyaWJ1dGVzXCIpXG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYWJpbGl0aWVzXCIpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnRDb25maWd1cmF0aW9ucygpXG4gICAgY29uc3QgY29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJjb21tYW5kc1wiKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIpXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIpXG4gICAgY29uc3QgY29sbGVjdGlvbkNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiY29sbGVjdGlvbkNvbW1hbmRzXCIpXG4gICAgY29uc3QgbWVtYmVyQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtZW1iZXJDb21tYW5kc1wiKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1vZGVsTmFtZVwiKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJwcmltYXJ5S2V5XCIpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInJlbGF0aW9uc2hpcHNcIilcbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzZXJ2ZXJcIilcbiAgICBjb25zdCBzeW5jID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwic3luY1wiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqL1xuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW119ICovIChhdHRyaWJ1dGVzIHx8IFtdKVxuICAgIH1cblxuICAgIGlmIChhYmlsaXRpZXMpIGNvbmZpZy5hYmlsaXRpZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYWJpbGl0aWVzKVxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgY29uZmlnLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoY29tbWFuZHMpIGNvbmZpZy5jb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChjb21tYW5kcylcbiAgICBpZiAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcykgY29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKSBjb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGJ1aWx0SW5NZW1iZXJDb21tYW5kcylcbiAgICBpZiAoY29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuY29sbGVjdGlvbkNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAobWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5tZW1iZXJDb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChtZW1iZXJDb21tYW5kcylcbiAgICBpZiAobW9kZWxOYW1lKSBjb25maWcubW9kZWxOYW1lID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChtb2RlbE5hbWUpXG4gICAgaWYgKHByaW1hcnlLZXkpIGNvbmZpZy5wcmltYXJ5S2V5ID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChwcmltYXJ5S2V5KVxuICAgIGlmIChyZWxhdGlvbnNoaXBzKSBjb25maWcucmVsYXRpb25zaGlwcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChyZWxhdGlvbnNoaXBzKVxuICAgIGlmIChzZXJ2ZXIpIGNvbmZpZy5zZXJ2ZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbn0gKi8gKHNlcnZlcilcbiAgICBpZiAoc3luYyAhPT0gdW5kZWZpbmVkKSBjb25maWcuc3luYyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbiB8IGJvb2xlYW59ICovIChzeW5jKVxuXG4gICAgcmV0dXJuIGNvbmZpZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBDb250cm9sbGVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIGlmICghdGhpcy5jb250cm9sbGVyKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcblxuICAgIHJldHVybiB0aGlzLmNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbjogdGhlIGNvbnRyb2xsZXIncyB3aGVuIHRoZSByZXNvdXJjZVxuICAgKiBzZXJ2ZXMgYSBjb250cm9sbGVyIHJlcXVlc3QsIG90aGVyd2lzZSB0aGUgY29uc3RydWN0b3ItaW5qZWN0ZWRcbiAgICogY29uZmlndXJhdGlvbiAoZm9yIGV4YW1wbGUgYSBzeW5jIHdlYnNvY2tldCBjaGFubmVsJ3MgcmVzb3VyY2UpLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgY29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250cm9sbGVyKSByZXR1cm4gdGhpcy5jb250cm9sbGVySW5zdGFuY2UoKS5nZXRDb25maWd1cmF0aW9uKClcbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uVmFsdWUpIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIG9yIGFuIGluamVjdGVkIGNvbmZpZ3VyYXRpb24uYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gTW9kZWwgY2xhc3MuXG4gICAqL1xuICBtb2RlbENsYXNzKCkge1xuICAgIGlmICghdGhpcy5tb2RlbENsYXNzVmFsdWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgY2xhc3MuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkYXRhYmFzZSBtb2RlbCBjbGFzcyB1c2VkIGJ5IHNlcnZlci1vbmx5IHJlc291cmNlIG9wZXJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtURGF0YWJhc2VNb2RlbENsYXNzfSAtIERhdGFiYXNlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZGF0YWJhc2VNb2RlbENsYXNzKCkge1xuICAgIC8vIE5hcnJvd3MgdGhlIHBvcnRhYmxlIHJlc291cmNlIGdlbmVyaWMgYXQgdGhlIGV4cGxpY2l0IGJhY2tlbmQtb3BlcmF0aW9uIGJvdW5kYXJ5LlxuICAgIHJldHVybiAvKiogQHR5cGUge1REYXRhYmFzZU1vZGVsQ2xhc3N9ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzLm1vZGVsQ2xhc3MoKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1aXJlZCBtb2RlbCBjbGFzcyBmb3IgYXV0aG9yaXphdGlvbiBoZWxwZXJzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHJlcXVpcmVkTW9kZWxDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTW9kZWwgbmFtZS5cbiAgICovXG4gIG1vZGVsTmFtZSgpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxOYW1lVmFsdWUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgbmFtZS5gKVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxOYW1lVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBhcmFtcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAtIFBhcmFtcy5cbiAgICovXG4gIHBhcmFtcygpIHsgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9ICovICh0aGlzLnBhcmFtc1ZhbHVlIHx8IHN1cGVyLnBhcmFtcygpIHx8IHt9KSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IC0gUmVzb3VyY2UgY29uZmlnIChub3JtYWxpemVkIGF0IHJ1bnRpbWU7IHJhdyBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAgICovXG4gIHJlc291cmNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5gKVxuXG4gICAgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgUmFpbHMtc3Ryb25nLXBhcmFtcyAvIGFwaV9tYWtlci1zdHlsZSBwZXJtaXQgc3BlYyBkZWNsYXJpbmdcbiAgICogd2hpY2ggYXR0cmlidXRlcyBhbmQgbmVzdGVkIGF0dHJpYnV0ZXMgYXJlIHdyaXRhYmxlIGZvciB0aGUgY3VycmVudFxuICAgKiByZXF1ZXN0LiBTdWJtaXR0aW5nIGFuIGF0dHJpYnV0ZSBvciBuZXN0ZWQtcmVsYXRpb25zaGlwIGtleSB0aGF0IGlzXG4gICAqIG5vdCBwZXJtaXR0ZWQgcmFpc2VzIGFuIGVycm9yIGFuZCBmYWlscyB0aGUgd3JpdGUuXG4gICAqXG4gICAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIGZsYXQgYXJyYXkgdGhhdCBtaXhlczpcbiAgICogICAtIGBcImF0dHJpYnV0ZU5hbWVcImAgc3RyaW5ncyBmb3IgcGxhaW4gYXR0cmlidXRlIHdyaXRlc1xuICAgKiAgIC0gYHs8cmVsYXRpb25zaGlwTmFtZT5BdHRyaWJ1dGVzOiBbLi4uXX1gIG9iamVjdHMgd2hlcmUgdGhlIHZhbHVlXG4gICAqICAgICBpcyBpdHNlbGYgYSBwZXJtaXQgc3BlYyBmb3IgdGhlIG5lc3RlZCByZWxhdGlvbnNoaXBcbiAgICpcbiAgICogVGhpcyBtYXRjaGVzIFJhaWxzIHN0cm9uZ19wYXJhbXMgKGBwZXJtaXQoOmZpcnN0X25hbWUsIDpsYXN0X25hbWUsXG4gICAqIGNvbnRhY3RfYXR0cmlidXRlczogWzplbWFpbCwgZGV0YWlsc19hdHRyaWJ1dGVzOiBbOmRldGFpbF1dKWApIGFuZFxuICAgKiB0aGUgYXBpX21ha2VyIHNpc3RlciBwcm9qZWN0LiBJbmNsdWRlIGBcIl9kZXN0cm95XCJgIGluc2lkZSBhIG5lc3RlZFxuICAgKiBwZXJtaXQgdG8gYWxsb3cgYF9kZXN0cm95OiB0cnVlYCBlbnRyaWVzIGZvciB0aGF0IHJlbGF0aW9uc2hpcCDigJRcbiAgICogdGhlIG1vZGVsIG11c3QgYWxzbyBkZWNsYXJlIGBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihuYW1lLFxuICAgKiB7YWxsb3dEZXN0cm95OiB0cnVlfSlgIGZvciB0aGUgZGVzdHJveSB0byBiZSBhcHBsaWVkLlxuICAgKlxuICAgKiBFeGFtcGxlOlxuICAgKlxuICAgKiAgIGNsYXNzIFByb2plY3RSZXNvdXJjZSBleHRlbmRzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uge1xuICAgKiAgICAgcGVybWl0dGVkUGFyYW1zKGFyZykge1xuICAgKiAgICAgICByZXR1cm4gW1xuICAgKiAgICAgICAgIFwibmFtZVwiLFxuICAgKiAgICAgICAgIFwiZGVzY3JpcHRpb25cIixcbiAgICogICAgICAgICB7dGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiLFxuICAgKiAgICAgICAgICAge3N1YnRhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gICAqICAgICAgICAgXX1cbiAgICogICAgICAgXVxuICAgKiAgICAgfVxuICAgKiAgIH1cbiAgICpcbiAgICogRGVmYXVsdCBpbXBsZW1lbnRhdGlvbiByZXR1cm5zIHRoZSBkZWNsYXJlZFxuICAgKiB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS53cml0YWJsZUF0dHJpYnV0ZXN9IHBlcm1pdCBsaXN0LCBvciBgW11gXG4gICAqIOKAlCBub3RoaW5nIHBlcm1pdHRlZCDigJQgd2l0aG91dCBhIGRlY2xhcmVkIGxpc3QuIFN1YmNsYXNzZXMgb3ZlcnJpZGUgdG9cbiAgICogY3VzdG9taXplOyBhbiBleHBsaWNpdCBvdmVycmlkZSBhbHdheXMgd2lucy5cbiAgICogQHBhcmFtIHt7YWN0aW9uPzogXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIsIHBhcmFtcz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYWJpbGl0eT86IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0LCBsb2NhbHM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBbYXJnXSAtIFJlcXVlc3QgY29udGV4dC5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGVybWl0IHNwZWMuXG4gICAqL1xuICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcInBlcm1pdHRlZFBhcmFtc1wiLCBbYXJnXSwgKCkgPT4ge1xuICAgICAgdm9pZCBhcmdcblxuICAgICAgcmV0dXJuIHRoaXMuZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSA/PyBbXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRlY2xhcmVkIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCBmcm9tIHRoZSBlbnZpcm9ubWVudFxuICAgKiByZXNvdXJjZSBmaXJzdCwgdGhlbiB0aGUgc2hhcmVkIHJlc291cmNlIOKAlCBtaXJyb3JpbmcgaG93IHRoZSBvdGhlclxuICAgKiBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIHJlc29sdmVzLiBBbiBleHBsaWNpdCBlbnZpcm9ubWVudCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucyBvdmVyIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSBEZWNsYXJlZCBwZXJtaXQgbGlzdCBvciBudWxsIHdoZW4gdW5kZWNsYXJlZC5cbiAgICovXG4gIGRlY2xhcmVkV3JpdGFibGVBdHRyaWJ1dGVzKCkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBwZXJtaXR0ZWRBdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWR9ICovIChSZXNvdXJjZUNsYXNzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIikpXG5cbiAgICByZXR1cm4gcGVybWl0dGVkQXR0cmlidXRlcyA/PyBudWxsXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBjbGllbnQtc2FmZSBlcnJvciB0aHJvd24gZm9yIGEgZmFpbGVkIHdyaXRhYmxlLWF0dHJpYnV0ZSB2YWxpZGF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7Y2F1c2U/OiBFcnJvciwgY29kZTogc3RyaW5nfX0gZGV0YWlscyAtIFN0YWJsZSBtYWNoaW5lLXJlYWRhYmxlIGNvZGUgYW5kIG9wdGlvbmFsIGNhdXNlLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IENsaWVudC1zYWZlIGVycm9yLlxuICAgKi9cbiAgd3JpdGFibGVBdHRyaWJ1dGVFcnJvcihtZXNzYWdlLCB7Y2F1c2UsIGNvZGV9KSB7XG4gICAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUobWVzc2FnZSwgY2F1c2UgPyB7Y2F1c2UsIGNvZGV9IDoge2NvZGV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhvcml6ZXMgb25lIHJvdXRlZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBiZWZvcmUgaXQgaXMgYXBwbGllZC5cbiAgICogRGVmYXVsdHMgdG8gYWxsb3dpbmcgZXZlcnkgbXV0YXRpb247IHJlY29yZC1sZXZlbCBhdXRob3JpemF0aW9uIHN0aWxsXG4gICAqIGFwcGxpZXMgdGhyb3VnaCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNmaW5kU3luY1JlY29yZH0gc2NvcGluZ1xuICAgKiBhbmQgdGhlIGNyZWF0ZSBtZW1iZXJzaGlwIGNoZWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb24gfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbj59IEF1dGhvcml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXV0aG9yaXplU3luY011dGF0aW9uKHtjb250ZXh0LCBtdXRhdGlvbn0pIHtcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4ge2FsbG93ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcGVyLXN5bmMgZmFpbHVyZSByZWFzb24gcmVwb3J0ZWQgd2hlbiBhIHJvdXRlZCBzeW5jIG11dGF0aW9uXG4gICAqIGZhaWxzIHJlY29yZC1sZXZlbCBhdXRob3JpemF0aW9uLiBEZWZhdWx0cyB0byBudWxsLCB3aGljaCByZXBvcnRzIHRoZVxuICAgKiBnZW5lcmljIFwiYWNjZXNzLWRlbmllZFwiIHJlYXNvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGFyZ3MuYWN0aW9uIC0gRGVuaWVkIGFjdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSBvciBudWxsIGZvciB0aGUgZ2VuZXJpYyBkZWZhdWx0LlxuICAgKi9cbiAgc3luY0F1dGhvcml6YXRpb25GYWlsdXJlUmVhc29uKHthY3Rpb24sIG11dGF0aW9ufSkge1xuICAgIHZvaWQgYWN0aW9uXG4gICAgdm9pZCBtdXRhdGlvblxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgZXhpc3RpbmcgcmVjb3JkIHRhcmdldGVkIGJ5IGEgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBEZWZhdWx0cyB0byBhbiBgYWNjZXNzaWJsZUZvcmAgbG9va3VwIGJ5IHByaW1hcnkga2V5IHRocm91Z2ggdGhlXG4gICAqIHJlc291cmNlJ3Mgbm9ybWFsaXplZCBhYmlsaXR5IGFjdGlvbiBmb3IgdXBkYXRlIChvciBkZXN0cm95IGZvciBkZWxldGVcbiAgICogbXV0YXRpb25zKSwgZmFsbGluZyBiYWNrIHRvIGFuIHVuc2NvcGVkIGxvb2t1cCB3aXRob3V0IGFuIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FyZ3MuYWJpbGl0eV0gLSBBYmlsaXR5IG92ZXJyaWRlLiBEZWZhdWx0cyB0byB0aGUgcmVzb3VyY2UgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5mb3JEZWxldGVdIC0gV2hldGhlciB0aGUgbG9va3VwIGlzIGZvciBhIGRlbGV0ZSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IEV4aXN0aW5nIHJlY29yZCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZmluZFN5bmNSZWNvcmQoe2FiaWxpdHkgPSB0aGlzLmFiaWxpdHksIGZvckRlbGV0ZSA9IGZhbHNlLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyBNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5zeW5jQWJpbGl0eUFjdGlvbihmb3JEZWxldGUgPyBcImRlc3Ryb3lcIiA6IFwidXBkYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgOiBNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeSh7W3ByaW1hcnlLZXldOiBtdXRhdGlvbi5yZXNvdXJjZUlkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgcmF3IHN5bmMgYWN0aW9uIHRvIHRoZSByZXNvdXJjZSdzIG5vcm1hbGl6ZWQgYWJpbGl0eSBhY3Rpb24gd2hlblxuICAgKiB0aGUgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBkZWNsYXJlcyBhbiBhYmlsaXRpZXMgbWFwcGluZywgb3RoZXJ3aXNlIHRoZVxuICAgKiByYXcgYWN0aW9uIG5hbWUgaXMgdXNlZCBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBhY3Rpb24gLSBSYXcgc3luYyBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEFiaWxpdHkgYWN0aW9uLlxuICAgKi9cbiAgc3luY0FiaWxpdHlBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZT8uYWJpbGl0aWVzXG5cbiAgICBpZiAoYWJpbGl0aWVzICYmIHR5cGVvZiBhYmlsaXRpZXMgPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uID09IFwic3RyaW5nXCIgJiYgYWJpbGl0eUFjdGlvbi5sZW5ndGggPiAwKSByZXR1cm4gYWJpbGl0eUFjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGdWxsIGVzY2FwZSBoYXRjaCBmb3Igcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uIFJldHVybmluZyBhXG4gICAqIG5vbi1udWxsIHJlc3VsdCByZXBsYWNlcyB0aGUgd2hvbGUgZGVmYXVsdCBhcHBseSBmbG93IChhdXRob3JpemF0aW9uLFxuICAgKiByZWNvcmQgbG9va3VwLCBub3JtYWxpemF0aW9uIGFuZCBzYXZlKSB3aXRoIHRoZSByZXR1cm5lZCBhcHBseSByZXN1bHQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3N9IGFyZ3MgLSBBcHBseSBhcmdzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGwgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHQgfCBudWxsPn0gQXBwbHkgcmVzdWx0IG9yIG51bGwgZm9yIHRoZSBkZWZhdWx0IGZsb3cuXG4gICAqL1xuICBhcHBseVN5bmMoYXJncykge1xuICAgIHZvaWQgYXJnc1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGEgcm91dGVkIHN5bmMgbXV0YXRpb24gd2FzIGFwcGxpZWQuIFJldHVybmVkIGVudHJpZXMgYXJlXG4gICAqIG1lcmdlZCBpbnRvIHRoZSBhcHBseSByZXN1bHQsIHJlYWNoaW5nIHBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgYW5kXG4gICAqIGJyb2FkY2FzdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY3JlYXRlZCAtIFdoZXRoZXIgdGhlIHJlY29yZCB3YXMgY3JlYXRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBhcmdzLnJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEV4dHJhIGFwcGx5LXJlc3VsdCBlbnRyaWVzLlxuICAgKi9cbiAgYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQsIG11dGF0aW9uLCByZWNvcmR9KSB7XG4gICAgdm9pZCBjb250ZXh0XG4gICAgdm9pZCBjcmVhdGVkXG4gICAgdm9pZCBtdXRhdGlvblxuICAgIHZvaWQgcmVjb3JkXG5cbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGNyZWF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzXCIsIFthdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBvcHRpb25zXG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHVwZGF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwibm9ybWFsaXplVXBkYXRlQXR0cmlidXRlc1wiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBOZXcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyQ3JlYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBVcGRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyVXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZURlc3Ryb3kobW9kZWwpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRGVzdHJveWVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlckRlc3Ryb3lcIiwgW21vZGVsXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV3JhcHMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IHJlc291cmNlIG11dGF0aW9ucy5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBNdXRhdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNdXRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmVzdWx0Pn0gYXJncy5jYWxsYmFjayAtIE11dGF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe2FjdGlvbiwgbW9kZWwsIGNhbGxiYWNrfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJydW5NdXRhdGlvblRyYW5zYWN0aW9uXCIsIFt7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9XSwgYXN5bmMgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cbiAgICAgIHZvaWQgbW9kZWxcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUHJpbWFyeSBrZXkuXG4gICAqL1xuICBwcmltYXJ5S2V5KCkgeyByZXR1cm4gdGhpcy5tb2RlbENsYXNzKCkucHJpbWFyeUtleSgpIH1cblxuICAvKipcbiAgICogUnVucyBhdXRob3JpemVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbn0gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBhdXRob3JpemVkUXVlcnkoYWN0aW9uKSB7XG4gICAgLy8gTmFycm93cyB0aGUgY29udHJvbGxlciBxdWVyeSB0byB0aGlzIHJlc291cmNlJ3MgbW9kZWwgY2xhc3MuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxURGF0YWJhc2VNb2RlbENsYXNzPn0gKi8gKHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeShhY3Rpb24pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5kZXggcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnN9IFtvcHRpb25zXSAtIFF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAtIEZyb250ZW5kLW1vZGVsIGluZGV4IHF1ZXJ5LlxuICAgKi9cbiAgaW5kZXhRdWVyeShvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5KHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICByZXNvdXJjZTogdGhpc1xuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggcGFnaW5hdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYWdpbmF0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbn0gYXJncy5wYWdpbmF0aW9uIC0gUGFnaW5hdGlvbiBwYXJhbXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFBhZ2luYXRpb24oe2NvbnRyb2xsZXIsIHBhZ2luYXRpb24sIHF1ZXJ5fSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbih7cGFnaW5hdGlvbiwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc2VhcmNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlYXJjaCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTZWFyY2goe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc29ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0fSBhcmdzLnNvcnQgLSBTb3J0IHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNvcnQoe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzb3J0fSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU29ydCh7cXVlcnksIHNvcnR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgcGx1Y2suXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgcGx1Y2sgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNQbHVjayhhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5yZWNvcmRzID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5yZWNvcmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBjb3VudC5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBjb3VudCBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0NvdW50KGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLnJlY29yZHMgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLnJlY29yZHMgfHxcbiAgICAgIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5jb3VudCAhPT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUuY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCB2b2lkIHwgUHJvbWlzZTxib29sZWFuIHwgdm9pZD59IC0gQ29udGludWUgcHJvY2Vzc2luZyB1bmxlc3MgZmFsc2UuXG4gICAqL1xuICBiZWZvcmVBY3Rpb24oYWN0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZUFjdGlvblwiLCBbYWN0aW9uXSwgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cblxuICAgICAgLy8gTm8tb3AgYnkgZGVmYXVsdC5cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gUmVjb3JkcyBmb3IgaW5kZXggYWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeSBvcHRpb25zIGZvciBjb3VudC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSAtIEluZGV4IHF1ZXJ5IG9wdGlvbnMgZm9yIGNvdW50LlxuICAgKi9cbiAgY291bnRJbmRleFF1ZXJ5T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlY29yZHMgY291bnQgZm9yIGluZGV4IGFjdGlvbi5cbiAgICovXG4gIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmluZGV4UXVlcnkodGhpcy5jb3VudEluZGV4UXVlcnlPcHRpb25zKCkpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7XCJmaW5kXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gTG9jYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmQoYWN0aW9uLCBpZCkge1xuICAgIGxldCBxdWVyeSA9IHRoaXMuYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICBjb25zdCBwcmVsb2FkID0gYWN0aW9uID09PSBcImZpbmRcIiA/IHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsUHJlbG9hZCgpIDogbnVsbFxuXG4gICAgaWYgKHByZWxvYWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5maW5kQnkoe1t0aGlzLnByaW1hcnlLZXkoKV06IGlkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gQ3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IFtvcHRpb25zXSAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIENyZWF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcImNyZWF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5kYXRhYmFzZU1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhNb2RlbENsYXNzLnByb3RvdHlwZSwgTW9kZWxDbGFzcywgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiY3JlYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlQ3JlYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlckNyZWF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgdW5hdXRob3JpemVkIGNyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQ3JlYXRlZCBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ2xlYW51cCBhZnRlciBmYWlsZWQgYXV0aG9yaXphdGlvbi5cbiAgICovXG4gIGFzeW5jIGhhbmRsZVVuYXV0aG9yaXplZENyZWF0ZWRNb2RlbChtb2RlbCkge1xuICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBVcGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gVXBkYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsLCBtb2RlbC5nZXRNb2RlbENsYXNzKCksIGF0dGFjaG1lbnRTcGxpdC5hdHRyaWJ1dGVzLCB0aGlzLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe1xuICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZVVwZGF0ZShtb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgICAgIGNvbnN0IHNhdmVkTW9kZWwgPSBhd2FpdCB0aGlzLl9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9uczogey4uLm9wdGlvbnMsIGF0dGFjaG1lbnRzOiBhdHRhY2htZW50U3BsaXQuYXR0YWNobWVudHN9LCBwZXJtaXR9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJVcGRhdGUoc2F2ZWRNb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG5cbiAgICAgICAgcmV0dXJuIHNhdmVkTW9kZWxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgbW9kZWwgYW5kIGFwcGxpZXMgbmVzdGVkIGF0dHJpYnV0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tmaWx0ZXJlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIG9wdGlvbnM6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zLCBwZXJtaXQ6IHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fX0gYXJncyAtIFNhdmUgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnMsIHBlcm1pdH0pIHtcbiAgICBhd2FpdCB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhtb2RlbCwgZmlsdGVyZWQpXG4gICAgICB0aGlzLl9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgICAgaWYgKG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMobW9kZWwsIG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcywgb3B0aW9ucy5jb250cm9sbGVyIHx8IG51bGwsIHBlcm1pdClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICAgIGlmIChvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKG1vZGVsLCBvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMsIG9wdGlvbnMuY29udHJvbGxlciB8fCBudWxsLCBwZXJtaXQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX3ByZWxvYWROZXN0ZWRXcml0YWJsZVJlbGF0aW9uc2hpcHMobW9kZWwsIHBlcm1pdClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgYXR0cmlidXRlcyB0byBhIG1vZGVsLCB1c2luZyB2aXJ0dWFsIHNldHRlcnMgb24gdGhlIHJlc291cmNlIHdoZW4gYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMobW9kZWwsIGF0dHJpYnV0ZXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBkaXJlY3RBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgdHJhbnNsYXRlZFNldCA9IG5ldyBTZXQoUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdKVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZVNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpfUF0dHJpYnV0ZWBcbiAgICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gdGhpcy5yZXNvdXJjZU1ldGhvZChyZXNvdXJjZVNldHRlck5hbWUpXG5cbiAgICAgIGlmIChyZXNvdXJjZVNldHRlcikge1xuICAgICAgICBhd2FpdCByZXNvdXJjZVNldHRlci5tZXRob2QuY2FsbChyZXNvdXJjZVNldHRlci5yZXNvdXJjZSwgbW9kZWwsIHZhbHVlKVxuICAgICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhuYW1lKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlT25Nb2RlbChtb2RlbCwgbmFtZSwgdmFsdWUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaXJlY3RBdHRyaWJ1dGVzW25hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGlyZWN0QXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgbW9kZWwuYXNzaWduKGRpcmVjdEF0dHJpYnV0ZXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBhdHRhY2htZW50LW5hbWVkIGF0dHJpYnV0ZXMgaW50byB0aGUgYXR0YWNobWVudCBwYXlsb2FkIHdoaWxlIHByZXNlcnZpbmcgbGVnYWN5IGNhbGxlcnNcbiAgICogdGhhdCBzdWJtaXR0ZWQgYXR0YWNobWVudHMgYXMgbm9ybWFsIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEV4cGxpY2l0IGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGF0dGFjaG1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfX0gQXR0cmlidXRlcyB3aXRoIGF0dGFjaG1lbnQga2V5cyByZW1vdmVkIGFuZCBtZXJnZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBhdHRhY2htZW50cykge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRoaXMubW9kZWxDbGFzcygpLmF0dGFjaG1lbnREZWZpbml0aW9ucygpXG4gICAgY29uc3QgYXR0YWNobWVudE5hbWVzID0gbmV3IFNldChPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpKVxuXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lcy5zaXplID09PSAwKSByZXR1cm4ge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzfVxuXG4gICAgaWYgKGF0dGFjaG1lbnRzICE9PSBudWxsICYmICFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlZ3VsYXJBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IG1lcmdlZEF0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgPyB7Li4uYXR0YWNobWVudHN9IDogbnVsbFxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoIWF0dGFjaG1lbnROYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgcmVndWxhckF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1lcmdlZEF0dGFjaG1lbnRzKSBtZXJnZWRBdHRhY2htZW50cyA9IHt9XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1lcmdlZEF0dGFjaG1lbnRzLCBhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJyR7YXR0cmlidXRlTmFtZX0nIHdhcyBzdWJtaXR0ZWQgaW4gYm90aCBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cy5gKVxuICAgICAgfVxuXG4gICAgICBtZXJnZWRBdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHthdHRyaWJ1dGVzOiByZWd1bGFyQXR0cmlidXRlcywgYXR0YWNobWVudHM6IG1lcmdlZEF0dGFjaG1lbnRzfVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhdHRhY2htZW50IHBheWxvYWRzIG9uIGEgbW9kZWwgYWZ0ZXIgdmFsaWRhdGluZyBwZXJtaXRzIGFuZCBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHJlY2VpdmluZyBhdHRhY2htZW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEF0dGFjaG1lbnRzIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGVybWl0dGVkQXR0cmlidXRlTmFtZXMgLSBBdHRyaWJ1dGUvYXR0YWNobWVudCBuYW1lcyBwZXJtaXR0ZWQgYnkgdGhlIHJlc291cmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgYXR0YWNobWVudHMsIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSB7XG4gICAgaWYgKCFhdHRhY2htZW50cykgcmV0dXJuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuXG4gICAgY29uc3QgcGVybWl0U2V0ID0gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcylcbiAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gbW9kZWxDbGFzcy5nZXRBdHRhY2htZW50c01hcCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBub3RQZXJtaXR0ZWRBdHRhY2htZW50cyA9IFtdXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBpbnZhbGlkQXR0YWNobWVudHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghcGVybWl0U2V0LmhhcyhhdHRhY2htZW50TmFtZSkpIHtcbiAgICAgICAgbm90UGVybWl0dGVkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb25zW2F0dGFjaG1lbnROYW1lXSkge1xuICAgICAgICBpbnZhbGlkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbW9kZWwuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkucXVldWVBdHRhY2godmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgbmFtZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgICBpZiAoaW52YWxpZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lczogJHtpbnZhbGlkQXR0YWNobWVudHMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHRyYW5zbGF0ZWQgYXR0cmlidXRlIG9uIGEgbW9kZWwgdmlhIHRoZSB0cmFuc2xhdGlvbnMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gdmFsdWUgLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQ/LmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uID8gY29uZmlndXJhdGlvbi5nZXRMb2NhbGUoKSA6IFwiZW5cIlxuICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwidHJhbnNsYXRpb25zXCIpXG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgdHJhbnNsYXRpb24gPSBsb2FkZWQuZmluZCgodCkgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0KS5sb2NhbGUoKSA9PT0gbG9jYWxlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGF3YWl0IG1vZGVsLmxvYWRSZWxhdGlvbnNoaXAoXCJ0cmFuc2xhdGlvbnNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgdHJhbnNsYXRpb24gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5idWlsZCh7bG9jYWxlfSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IHt9XG5cbiAgICBhc3NpZ25tZW50c1tuYW1lXSA9IHZhbHVlXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveShtb2RlbCkge1xuICAgIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZURlc3Ryb3kobW9kZWwpXG4gICAgICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyRGVzdHJveShtb2RlbClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHRvIHNlcmlhbGl6ZS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwifSBbYWN0aW9uXSAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemUobW9kZWwsIGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY29tbW9uIG1ldGFkYXRhIGZvciBvbmUgbmVzdGVkLWF0dHJpYnV0ZXMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5lc3RlZCByZWxhdGlvbnNoaXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCByZWNlaXZpbmcgbmVzdGVkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgZnJvbSB0aGUgcmVxdWVzdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgY2hpbGQgcmVzb3VyY2UgbG9va3VwLlxuICAgKiBAcmV0dXJucyB7e2FiaWxpdHk6IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBjaGlsZFJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLCBjaGlsZFJlc291cmNlQ29uZmlnOiBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSwgZGVzdHJveVBlcm1pdHRlZDogYm9vbGVhbiwgZW50cmllczogQXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+LCByZWxhdGlvbnNoaXA6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCwgdGFyZ2V0TW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gTmVzdGVkIHJlbGF0aW9uc2hpcCBjb250ZXh0LlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe3BhcmVudCwgcmVsYXRpb25zaGlwTmFtZSwgcmF3RW50cmllcywgY2hpbGRQZXJtaXQsIGNvbnRyb2xsZXJ9KSB7XG4gICAgaWYgKCFjb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgcmVxdWlyZSBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcbiAgICB9XG5cbiAgICBjb25zdCBwYXJlbnRNb2RlbENsYXNzID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IG1vZGVsQWNjZXB0YW5jZSA9IHBhcmVudE1vZGVsQ2xhc3MuYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIW1vZGVsQWNjZXB0YW5jZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWNjZXB0IG5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIERlY2xhcmUgaXQgdmlhICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScpLmApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcGFyZW50TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgIGNvbnN0IHJhd05vcm1hbGl6ZWRFbnRyaWVzID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pXG4gICAgY29uc3QgZGVzdHJveVBlcm1pdHRlZCA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJfZGVzdHJveVwiKVxuXG4gICAgaWYgKGRlc3Ryb3lQZXJtaXR0ZWQgJiYgIW1vZGVsQWNjZXB0YW5jZS5hbGxvd0Rlc3Ryb3kpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgcGVybWl0cyBfZGVzdHJveSBvbiBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IHRoZSBtb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWxsb3cgZGVzdHJveSBmb3IgdGhhdCByZWxhdGlvbnNoaXAuIFNldCB7YWxsb3dEZXN0cm95OiB0cnVlfSBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nLCAuLi4pLmApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLmxpbWl0ID09PSBcIm51bWJlclwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IG1vZGVsQWNjZXB0YW5jZS5saW1pdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZXhjZWVkcyBtb2RlbC1kZWNsYXJlZCBsaW1pdCBvZiAke21vZGVsQWNjZXB0YW5jZS5saW1pdH0uYClcbiAgICB9XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzTWFueVwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGFjY2VwdHMgb25lIGVudHJ5IGZvciAke3JlbGF0aW9uc2hpcFR5cGV9IHJlbGF0aW9uc2hpcHMuYClcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyByZXNvbHZlZCBmb3IgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlQ29uZmlnID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCFjaGlsZFJlc291cmNlQ29uZmlnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdGVyZWQgZm9yIGNoaWxkIG1vZGVsICcke3RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyB1bmRlciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nLmApXG4gICAgfVxuXG4gICAgY29uc3QgQ2hpbGRSZXNvdXJjZSA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNsYXNzKVxuICAgIGNvbnN0IGNoaWxkUmVzb3VyY2UgPSBuZXcgQ2hpbGRSZXNvdXJjZSh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0IHx8IHt9LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBtb2RlbE5hbWU6IGNoaWxkUmVzb3VyY2VDb25maWcubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiX2Rlc3Ryb3lcIilcbiAgICBjb25zdCBlbnRyaWVzID0gcmF3Tm9ybWFsaXplZEVudHJpZXNcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkpXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIG1vZGVsQWNjZXB0YW5jZS5yZWplY3RJZiAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdHJ1ZVxuXG4gICAgICAgIHJldHVybiAhbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmKGlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykgPyBlbnRyeS5hdHRyaWJ1dGVzIDoge30pXG4gICAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdHk6IGNvbnRyb2xsZXIuY3VycmVudEFiaWxpdHkoKSB8fCB0aGlzLmFiaWxpdHksXG4gICAgICBjaGlsZFJlc291cmNlLFxuICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZyxcbiAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgZGVzdHJveVBlcm1pdHRlZCxcbiAgICAgIGVudHJpZXMsXG4gICAgICByZWxhdGlvbnNoaXAsXG4gICAgICB0YXJnZXRNb2RlbENsYXNzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgbmVzdGVkIGVudHJpZXMgZm9yIGNvbGxlY3Rpb24gYW5kIHNpbmd1bGFyIHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIGVudHJpZXMgaW5wdXRzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gYXJncy5yYXdFbnRyaWVzIC0gUmF3IG5lc3RlZCBlbnRyaWVzIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5Pn0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkgb2JqZWN0cy5cbiAgICovXG4gIF9uZXN0ZWRSZWxhdGlvbnNoaXBFbnRyaWVzKHtyYXdFbnRyaWVzLCByZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBUeXBlfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJhd0VudHJpZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXJyYXkgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHJhd0VudHJpZXMgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghaXNQbGFpbk9iamVjdChyYXdFbnRyaWVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgcmV0dXJuIFsvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAocmF3RW50cmllcyldXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmVzdGVkIGVudHJ5IGZyb20gZWl0aGVyIGludGVybmFsIHRyYW5zcG9ydCBzaGFwZVxuICAgKiAoYHthdHRyaWJ1dGVzLCBhdHRhY2htZW50cywgbmVzdGVkQXR0cmlidXRlc31gKSBvciBkaXJlY3QgUmFpbHMtc3R5bGVcbiAgICogZmllbGRzIChge25hbWUsIGZpbGUsIGNvbW1lbnRzQXR0cmlidXRlc31gKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOb3JtYWxpemF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncy5jaGlsZFBlcm1pdCAtIFBhcnNlZCBjaGlsZCBwZXJtaXQgc3BlYy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gYXJncy5lbnRyeSAtIFJhdyBuZXN0ZWQgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeS5cbiAgICovXG4gIF9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGlkIG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLmlkID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IF9kZXN0cm95IG11c3QgYmUgYSBib29sZWFuLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLl9kZXN0cm95ID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0YWNobWVudHNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRhY2htZW50cyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dGFjaG1lbnRzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwibmVzdGVkQXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IG5lc3RlZEF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihuZXN0ZWRBdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbmVzdGVkIGF0dHJpYnV0ZXMga2V5OiAke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgICAgaWYgKCFjaGlsZFBlcm1pdC5uZXN0ZWRbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgdW5kZXIgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBJbmNsdWRlIHske2F0dHJpYnV0ZU5hbWV9OiBbLi4uXX0gaW4gdGhhdCBuZXN0ZWQgcGVybWl0LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1thdHRyaWJ1dGVOYW1lXSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBiZWxvbmdzLXRvIG5lc3RlZCBhdHRyaWJ1dGVzIGJlZm9yZSB0aGUgcGFyZW50IHNhdmUgc28gdGhlIHBhcmVudCBGSyBjYW4gYmUgc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChjb250ZXh0LnJlbGF0aW9uc2hpcCwgcGFyZW50LmdldE1vZGVsQ2xhc3MoKSlcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG5cbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgICAgIHBhcmVudC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgbnVsbClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuICAgICAgICBjb25zdCBjaGlsZCA9IGlkICE9IHVuZGVmaW5lZFxuICAgICAgICAgID8gYXdhaXQgdGhpcy5fZmluZE5lc3RlZFJlY29yZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG4gICAgICAgICAgOiBuZXcgY29udGV4dC50YXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fYXV0aG9yaXplQ3JlYXRlZENoaWxkKHtcbiAgICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG5cbiAgICAgICAgcGFyZW50LnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBjaGlsZC5pZCgpKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgYG5lc3RlZEF0dHJpYnV0ZXNgIHBheWxvYWQgdG8gYSBmcmVzaGx5LXNhdmVkIHBhcmVudCBtb2RlbCxcbiAgICogY2FzY2FkaW5nIGNyZWF0ZS91cGRhdGUvZGVzdHJveSB3cml0ZXMgYWNyb3NzIHRoZSBkZWNsYXJlZCByZWxhdGlvbnNoaXBzLlxuICAgKlxuICAgKiBFYWNoIGNoaWxkIGlzIGF1dGhvcml6ZWQgYWdhaW5zdCBpdHMgb3duIHJlc291cmNlJ3MgYWJpbGl0aWVzIChuZXZlciB0aGVcbiAgICogcGFyZW50J3MpLiBEZXN0cm95cyBydW4gYmVmb3JlIHVwZGF0ZXMsIHVwZGF0ZXMgYmVmb3JlIGNyZWF0ZXMsIHRvIGF2b2lkXG4gICAqIHVuaXF1ZS1jb25zdHJhaW50IGNvbmZsaWN0cyB3aGVuIHJlcGxhY2luZyBhIGNoaWxkIGF0IHRoZSBzYW1lIG5hdHVyYWwga2V5LlxuICAgKlxuICAgKiBBdHRyaWJ1dGUgZmlsdGVyaW5nIGZvciBuZXN0ZWQgY2hpbGRyZW4gdXNlcyB0aGUgcGFyZW50IHJlc291cmNlJ3NcbiAgICogcGVybWl0IHNwZWMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlCBhcGlfbWFrZXItc3R5bGUuIFBvbGljeSBvcHRpb25zXG4gICAqIChhbGxvd0Rlc3Ryb3ksIGxpbWl0LCByZWplY3RJZikgY29tZSBmcm9tIHRoZSBNT0RFTCdzXG4gICAqIGBhY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IobmFtZSlgIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nIGFyZSBub3QgcGVybWl0dGVkIGJ5ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKS4gSW5jbHVkZSB7JHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXM6IFsuLi5dfSBpbiB0aGUgcmV0dXJuZWQgcGVybWl0LmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgcGFyZW50TGlua0F0dHJpYnV0ZXMgPSB0aGlzLl9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByZWxhdGlvbnNoaXA6IGNvbnRleHQucmVsYXRpb25zaGlwLFxuICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlc3Ryb3lFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHVwZGF0ZUVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgY3JlYXRlRW50cmllcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udGV4dC5lbnRyaWVzKSB7XG4gICAgICAgIGlmIChlbnRyeT8uX2Rlc3Ryb3kpIHtcbiAgICAgICAgICBpZiAoIWNvbnRleHQuZGVzdHJveVBlcm1pdHRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgcmVxdWVzdGVkIF9kZXN0cm95IGJ1dCBcIl9kZXN0cm95XCIgaXMgbm90IGluIHRoZSBwZXJtaXQgZm9yIHRoaXMgcmVsYXRpb25zaGlwLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZW50cnkuaWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVzdHJveUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfSBlbHNlIGlmIChlbnRyeT8uaWQpIHtcbiAgICAgICAgICB1cGRhdGVFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3JlYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZGVzdHJveUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLmRlc3Ryb3koZXhpc3RpbmcpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdXBkYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIHVwZGF0ZSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBwYXJlbnQsXG4gICAgICAgICAgcGFyZW50TGlua0F0dHJpYnV0ZXMsXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQ6IGV4aXN0aW5nLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgZXhpc3Rpbmcuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjcmVhdGVFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgY2hpbGQuYXNzaWduKHBhcmVudExpbmtBdHRyaWJ1dGVzKVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgb25lIG5lc3RlZCBlbnRyeSdzIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzIHRvIGEgY2hpbGQgbW9kZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzaWdubWVudCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCByZWNlaXZpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyAtIFBlcm1pdHRlZCBjaGlsZCBhdHRyaWJ1dGUgYW5kIGF0dGFjaG1lbnQgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmVudHJ5IC0gTmVzdGVkIGVudHJ5IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7Y2hpbGQsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLCBlbnRyeX0pIHtcbiAgICBpZiAoZW50cnkuYXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRyaWJ1dGVzIHRvIGJlIGFuIG9iamVjdC5cIilcblxuICAgICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKGNoaWxkLCBjaGlsZC5nZXRNb2RlbENsYXNzKCksIGVudHJ5LmF0dHJpYnV0ZXMsIHRoaXMsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKGNoaWxkLCBmaWx0ZXJlZClcbiAgICB9XG5cbiAgICBpZiAoZW50cnkuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCAmJiAhaXNQbGFpbk9iamVjdChlbnRyeS5hdHRhY2htZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMoY2hpbGQsIGVudHJ5LmF0dGFjaG1lbnRzID8/IG51bGwsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgcmVsYXRpb25zaGlwJ3MgZm9yZWlnbi1rZXkgY29sdW1uL25hbWUgdG8gdGhlIHRhcmdldCBtb2RlbCdzIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGNvbnRhaW5pbmcgdGhlIEZLLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JlaWduLWtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIF9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgIHJldHVybiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtmb3JlaWduS2V5XSB8fCBmb3JlaWduS2V5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgRksgYXR0cmlidXRlcyB0aGF0IGJpbmQgYSBuZXN0ZWQgY2hpbGQgdG8gaXRzIHBhcmVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYXJlbnQtbGluayBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IEF0dHJpYnV0ZXMgdGhhdCBzY29wZSB0aGUgY2hpbGQgdG8gdGhlIHBhcmVudC5cbiAgICovXG4gIF9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtwYXJlbnQsIHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHtbZm9yZWlnbktleV06IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAocGFyZW50LmlkKCkpfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICBjb25zdCB0eXBlQXR0cmlidXRlID0gdGhpcy5fcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBhdHRyaWJ1dGVzW3R5cGVBdHRyaWJ1dGVdID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBwb2x5bW9ycGhpYyB0eXBlIGNvbHVtbi9uYW1lIHRvIGEgY2hpbGQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgdHlwZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBvbHltb3JwaGljIHR5cGUgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpY1R5cGVDb2x1bW4oKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3R5cGVDb2x1bW5dIHx8IHR5cGVDb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBhdXRob3JpemVkIG5lc3RlZCByZWNvcmQgYnkgaWQgd2l0aG91dCBwYXJlbnQgc2NvcGluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQXV0aG9yaXplZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kTmVzdGVkUmVjb3JkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkoe1twcmltYXJ5S2V5XTogaWR9KVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgJHthY3Rpb259IG5lc3RlZCAke3JlbGF0aW9uc2hpcE5hbWV9W2lkPSR7aWR9XTogcmVjb3JkIG5vdCBmb3VuZCBvciBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cblxuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhYmlsaXR5IGFjdGlvbiBmb3IgYSBjaGlsZCByZXNvdXJjZSB1c2luZyB0aGUgY2hpbGQncyBvd25cbiAgICogYGFiaWxpdGllc2AgbWFwcGluZyDigJQgbmV2ZXIgdGhlIHBhcmVudCBjb250cm9sbGVyJ3MuIFRoaXMgcHJlc2VydmVzXG4gICAqIGN1c3RvbSBtYXBwaW5ncyBsaWtlIGB7dXBkYXRlOiBcIm1hbmFnZVwifWAgYW5kIGNhdGNoZXMgdW5tYXBwZWQgYWN0aW9uc1xuICAgKiBpbnN0ZWFkIG9mIHNpbGVudGx5IGRlZmF1bHRpbmcgdG8gdGhlIHJhdyBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFiaWxpdHkgYWN0aW9uIGZvciB0aGUgY2hpbGQgcmVzb3VyY2UuXG4gICAqL1xuICBfcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24/LmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFuICdhYmlsaXRpZXMnIG9iamVjdCB0byBhdXRob3JpemUgbmVzdGVkICR7YWN0aW9ufS5gKVxuICAgIH1cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFiaWxpdGllcy4ke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICByZXR1cm4gYWJpbGl0eUFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFuIGV4aXN0aW5nIGNoaWxkIGZvciBhIG5lc3RlZCB1cGRhdGUvZGVzdHJveSwgc2NvcGVkIHRvIHRoZVxuICAgKiBjaGlsZCdzIG93biBtb2RlbCBjbGFzcywgdGhlIHBhcmVudCdzIGZvcmVpZ24ga2V5LCBBTkQgdGhlIGNoaWxkXG4gICAqIHJlc291cmNlJ3MgYWJpbGl0eSBtYXBwaW5nIGZvciB0aGUgcmVxdWVzdGVkIGFjdGlvbi4gVGhyb3dzIHdoZW4gdGhlXG4gICAqIGNoaWxkIGRvZXMgbm90IGV4aXN0LCBkb2VzIG5vdCBiZWxvbmcgdG8gdGhlIGN1cnJlbnQgcGFyZW50LCBvciBpc1xuICAgKiBub3QgYXV0aG9yaXplZCDigJQgYWxsIG9mIHdoaWNoIG11c3Qgcm9sbCB0aGUgdHJhbnNhY3Rpb24gYmFjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gYXJncy5pZCAtIENoaWxkIGlkIGZyb20gdGhlIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGFyZ3MucGFyZW50TGlua0F0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCwgcGFyZW50LWxpbmtlZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kU2NvcGVkQ2hpbGQoe2FiaWxpdHksIGFjdGlvbiwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGlkLCBwYXJlbnQsIHBhcmVudExpbmtBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGxvb2t1cCA9IHtbcHJpbWFyeUtleV06IGlkLCAuLi5wYXJlbnRMaW5rQXR0cmlidXRlc31cbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShsb29rdXApXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kLCBkb2VzIG5vdCBiZWxvbmcgdG8gcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0sIG9yIGlzIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgYW4gYWxyZWFkeS1zYXZlZCBuZXN0ZWQgY2hpbGQgaXMgYXV0aG9yaXplZCB1bmRlciB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBvd24gYGNyZWF0ZWAgYWJpbGl0eS4gUm9sbHMgYmFjayB2aWEgdGhyb3duIGVycm9yIHdoZW4gbm90XG4gICAqIGF1dGhvcml6ZWQgc28gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGRlc3Ryb3lzIHRoZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCBpbnN0YW5jZSBqdXN0IGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe2FiaWxpdHksIGNoaWxkLCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIWFiaWxpdHkpIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRhcmdldE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgYXV0aG9yaXplZElkcyA9IGF3YWl0IHRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIC5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24sIGFiaWxpdHkpXG4gICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogY2hpbGQucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5KX0pXG4gICAgICAucGx1Y2socHJpbWFyeUtleSlcblxuICAgIGlmIChhdXRob3JpemVkSWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgY3JlYXRlIG9uICR7cmVsYXRpb25zaGlwTmFtZX1bJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9XSBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBuZXN0ZWQgd3JpdGVzLCBwcmVsb2FkIGV2ZXJ5IHJlbGF0aW9uc2hpcCBkZWNsYXJlZCBpbiB0aGVcbiAgICogcGFyZW50J3MgcGVybWl0IHNvIHRoZSBwb3N0LXNhdmUgc2VyaWFsaXplIHN0ZXAgZW1pdHMgdGhlbSBhbmQgdGhlXG4gICAqIGNsaWVudCBjYW4gcmVjb25jaWxlIGlkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBTYXZlZCBwYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IHBlcm1pdCAtIFBhcnNlZCBwYXJlbnQgcGVybWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lcyA9IE9iamVjdC5rZXlzKHBlcm1pdC5uZXN0ZWQpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZWxhdGlvbnNoaXBOYW1lcykge1xuICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFBhcnNlcyB0aGUgUmFpbHMvYXBpX21ha2VyLXN0eWxlIGZsYXQgcGVybWl0IHNwZWMgcmV0dXJuZWQgZnJvbVxuICogYHBlcm1pdHRlZFBhcmFtcyhhcmcpYCBpbnRvIGEgc3RydWN0dXJlZCBzaGFwZSB1c2VkIGludGVybmFsbHkgYnkgdGhlXG4gKiB3cml0ZSBwaXBlbGluZS4gU3RyaW5ncyBiZWNvbWUgYXR0cmlidXRlIHBlcm1pdHM7IG9iamVjdHMgd2hvc2Uga2V5c1xuICogZW5kIGluIGBBdHRyaWJ1dGVzYCBiZWNvbWUgbmVzdGVkIHBlcm1pdHMgKHRoZSBrZXkgcHJlZml4IG5hbWVzIHRoZVxuICogcmVsYXRpb25zaGlwKS5cbiAqXG4gKiAgIHBhcnNlUGVybWl0dGVkUGFyYW1zKFtcImZpcnN0TmFtZVwiLCBcImxhc3ROYW1lXCIsXG4gKiAgICAge3Rhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gKiAgIF0pXG4gKiAgIC8vIOKGkiB7XG4gKiAgIC8vICAgYXR0cmlidXRlczogW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIl0sXG4gKiAgIC8vICAgbmVzdGVkOiB7XG4gKiAgIC8vICAgICB0YXNrczoge2F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdLCBuZXN0ZWQ6IHt9fVxuICogICAvLyAgIH1cbiAqICAgLy8gfVxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+IHwgdW5kZWZpbmVkfSBwZXJtaXRTcGVjIC0gRmxhdCBwZXJtaXQgc3BlYy5cbiAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fX0gLSBQYXJzZWQgc3RydWN0dXJlLlxuICovXG5mdW5jdGlvbiBwYXJzZVBlcm1pdHRlZFBhcmFtcyhwZXJtaXRTcGVjKSB7XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgY29uc3QgbmVzdGVkID0ge31cblxuICBpZiAoIUFycmF5LmlzQXJyYXkocGVybWl0U3BlYykpIHJldHVybiB7YXR0cmlidXRlcywgbmVzdGVkfVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgcGVybWl0U3BlYykge1xuICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGF0dHJpYnV0ZXMucHVzaChlbnRyeSlcbiAgICB9IGVsc2UgaWYgKGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBuZXN0ZWQgcmVsYXRpb25zaGlwIGtleXMgbXVzdCBlbmQgaW4gXCJBdHRyaWJ1dGVzXCIgKGdvdCBcIiR7a2V5fVwiKS4gVXNlIFwiJHtrZXl9QXR0cmlidXRlc1wiIGluc3RlYWQuYClcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0ga2V5LnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogZW1wdHkgcmVsYXRpb25zaGlwIG5hbWUgaW4ga2V5IFwiJHtrZXl9XCIuYClcbiAgICAgICAgfVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeSBmb3IgXCIke2tleX1cIjogZXhwZWN0ZWQgYXJyYXkgcGVybWl0IHNwZWMsIGdvdCAke3R5cGVvZiB2YWx1ZX0uYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXSA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHZhbHVlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBleHBlY3RlZCBzdHJpbmcgb3IgbmVzdGVkLWF0dHJpYnV0ZXMgb2JqZWN0LCBnb3QgJHt0eXBlb2YgZW50cnl9LmApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG59XG5cbi8qKlxuICogTG9jYXRlcyB3aGljaCBwcm90b3R5cGUgb3ducyBhIG1ldGhvZCBpbXBsZW1lbnRhdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBpbnN0YW5jZSAtIEluc3RhbmNlIHJlY2VpdmluZyB0aGUgbWV0aG9kLlxuICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAqIEByZXR1cm5zIHtvYmplY3QgfCBudWxsfSAtIFByb3RvdHlwZSB0aGF0IG93bnMgdGhlIG1ldGhvZC5cbiAqL1xuZnVuY3Rpb24gcHJvdG90eXBlT3duZXJGb3JNZXRob2QoaW5zdGFuY2UsIG1ldGhvZE5hbWUpIHtcbiAgbGV0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihpbnN0YW5jZSlcblxuICB3aGlsZSAocHJvdG90eXBlKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwcm90b3R5cGUsIG1ldGhvZE5hbWUpKSByZXR1cm4gcHJvdG90eXBlXG5cbiAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZpbHRlciB3cml0YWJsZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBSZXNvdXJjZU1vZGVsQ2xhc3NcbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzc1xuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlY2VpdmVyIC0gTW9kZWwgaW5zdGFuY2Ugb3IgcHJvdG90eXBlLlxuICogQHBhcmFtIHtXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3N9IHJlY2VpdmVyQ2xhc3MgLSBTdGF0aWMgaGVscGVyIG93bmVyIGZvciB0aGUgcmVjZWl2ZXIuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8UmVzb3VyY2VNb2RlbENsYXNzLCBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsfSBbcmVzb3VyY2VdIC0gUmVzb3VyY2UgaW5zdGFuY2UgZm9yIHZpcnR1YWwtc2V0dGVyIGRldGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCBudWxsfSBbcGVybWl0dGVkQXR0cmlidXRlTmFtZXNdIC0gT3B0aW9uYWwgZXhwbGljaXQgcGVybWl0IGxpc3QuIGBudWxsYCBmYWxscyBiYWNrIHRvIHNldHRlci1leGlzdGVuY2UgY2hlY2tzIG9ubHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdyaXRhYmxlIGF0dHJpYnV0ZXMgb25seS5cbiAqL1xuZnVuY3Rpb24gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhcbiAgcmVjZWl2ZXIsXG4gIHJlY2VpdmVyQ2xhc3MsXG4gIGF0dHJpYnV0ZXMsXG4gIHJlc291cmNlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFJlc291cmNlTW9kZWxDbGFzcywgUmVzb3VyY2VEYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbH0gKi8gKG51bGwpLFxuICBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyA9IG51bGxcbikge1xuICAvLyBGcm9udGVuZC1tb2RlbCB3cml0ZXMgc2hvdWxkIGZhaWwgZmFzdCB3aGVuIGNhbGxlcnMgc3VibWl0IHJlYWQtb25seSBvciB1bmtub3duIGF0dHJzLlxuICAvLyBTaWxlbnQgZHJvcHMgaGlkZSBjb250cmFjdCBtaXN0YWtlcyBpbiBnZW5lcmF0ZWQgbW9kZWxzIGFuZCBhcHAtc2lkZSB3cmFwcGVyIGNvZGUuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCB3cml0YWJsZUF0dHJpYnV0ZXMgPSB7fVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMgPSBbXVxuXG4gIGNvbnN0IHBlcm1pdFNldCA9IEFycmF5LmlzQXJyYXkocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpID8gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgOiBudWxsXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGxldCB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgaWYgKHJlc291cmNlKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcblxuICAgIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdXG4gIH1cblxuICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldCh0cmFuc2xhdGVkQXR0cmlidXRlcylcblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAocGVybWl0U2V0ICYmICFwZXJtaXRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gcmVjZWl2ZXJDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB8fCBhdHRyaWJ1dGVOYW1lXG4gICAgY29uc3QgcmVxdWVzdGVkU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHJlY2VpdmVyQ2xhc3MuZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZShyZWNlaXZlciwgcmVxdWVzdGVkU2V0dGVyTmFtZSkgfHwgcmVxdWVzdGVkU2V0dGVyTmFtZVxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9QXR0cmlidXRlYFxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gcmVzb3VyY2U/LnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgIGlmIChzZXR0ZXJOYW1lIGluIHJlY2VpdmVyKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2Uge1xuICAgICAgaW52YWxpZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIGlmIChub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBGcm9udGVuZCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzIG5vdCBwZXJtaXR0ZWQgYnkgcGVybWl0dGVkUGFyYW1zKCk6ICR7bm90UGVybWl0dGVkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgfVxuXG4gIHJldHVybiB3cml0YWJsZUF0dHJpYnV0ZXNcbn1cbiJdfQ==