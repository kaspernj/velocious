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
     * @param {FrontendModelResourceAbilityArgs<FrontendModelResourceModelClass> | FrontendModelResourceControllerArgs} args - Resource args.
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
        // Narrows an explicit model override to the resource subclass's declared model generic.
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
        const sharedResource = new SharedResource({
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
        if (!this.isBackend())
            throw new Error(`${this.constructor.name} database operations require the backend resource runtime.`);
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
        const childResource = new childResourceConfig.resourceClass({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7OztHQVlHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7O0dBTUc7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7O0dBS0c7QUFFSDs7O0dBR0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7R0FHRztBQUVIOzs7O0dBSUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHlCQUEwQixTQUFRLHlCQUF5QjtJQUM5RSwwREFBMEQ7SUFDMUQsTUFBTSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7SUFFN0IsbUZBQW1GO0lBQ25GLE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBQzdCLG1DQUFtQztJQUNuQyxNQUFNLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtJQUM1QixtSEFBbUg7SUFDbkgsTUFBTSxDQUFDLFdBQVcsR0FBRyxTQUFTLENBQUE7SUFDOUIsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxRQUFRLEdBQUcsU0FB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QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBCYWNrZW5kIG9yIGZyb250ZW5kIG1vZGVsIGNsYXNzIGJvdW5kIHRvIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCIpLkF1dGhvcml6YXRpb25SZXNvdXJjZU1vZGVsQ2xhc3MgJiB7YXR0YWNobWVudERlZmluaXRpb25zOiAoKSA9PiBSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4sIHByaW1hcnlLZXk6ICgpID0+IHN0cmluZ319IEZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3NcbiAqL1xuXG4vKipcbiAqIEJ1aWx0LWluIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGFjdGlvbi5cbiAqIEB0eXBlZGVmIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIG1ldGhvZHMgdXNlZCBieSByZXNvdXJjZXMuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0ICYge1xuICogICBjdXJyZW50QWJpbGl0eTogKCkgPT4gaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFBhZ2luYXRpb246IChhcmdzOiB7cGFnaW5hdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbiwgcXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0pID0+IHZvaWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaDogKGFyZ3M6IHtxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LCBzZWFyY2g6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0pID0+IHZvaWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFNvcnQ6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc29ydDogRnJvbnRlbmRNb2RlbFJlc291cmNlU29ydH0pID0+IHZvaWQsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QWN0aW9uOiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IHN0cmluZyxcbiAqICAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnk6IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbikgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEluZGV4UXVlcnk6IChvcHRpb25zPzogRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnMgJiB7cmVzb3VyY2U/OiBQaWNrPEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8RnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4sIFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydFwiPn0pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbFBhcmFtczogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMsXG4gKiAgIGZyb250ZW5kTW9kZWxQcmVsb2FkOiAoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbCxcbiAqICAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3M6IChtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGwsXG4gKiAgIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWw6IChtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgb2JqZWN0IHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+PlxuICogfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlclxuICovXG5cbi8qKlxuICogR2VuZXJpYyBmcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeSBwYXNzZWQgdG8gcmVzb3VyY2UgcXVlcnkgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBpbmRleCBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3NcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gY29udHJvbGxlciAtIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gKG9yIHJhdyBpbnB1dCBzaGFwZSBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHR5cGUuXG4gKiBAdGVtcGxhdGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3N9IFtUTW9kZWxDbGFzcz1Gcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzXVxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3NcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2Ugd2hlbiB0aGUgcmVzb3VyY2UgaXMgdXNlZCBkaXJlY3RseSBmb3IgYXV0aG9yaXphdGlvbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbY29uZmlndXJhdGlvbl0gLSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbiBmb3IgY29udHJvbGxlci1sZXNzIGNvbnN0cnVjdGlvbiAoZm9yIGV4YW1wbGUgdGhlIHN5bmMgd2Vic29ja2V0IGNoYW5uZWwpOyB0aGUgY29udHJvbGxlciBwYXRoIGRlcml2ZXMgaXQgZnJvbSB0aGUgY29udHJvbGxlciBpbnN0ZWFkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSBbY29udGV4dF0gLSBBYmlsaXR5IGNvbnRleHQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtsb2NhbHNdIC0gQWJpbGl0eSBsb2NhbHMuXG4gKiBAcHJvcGVydHkge1RNb2RlbENsYXNzfSBbbW9kZWxDbGFzc10gLSBPcHRpb25hbCBiYWNraW5nIG1vZGVsIGNsYXNzIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFttb2RlbE5hbWVdIC0gT3B0aW9uYWwgbW9kZWwgbmFtZSBvdmVycmlkZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBbcmVzb3VyY2VDb25maWd1cmF0aW9uXSAtIE9wdGlvbmFsIG5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZWQgc3luYyByZXBsYXkgbXV0YXRpb24gcGFzc2VkIHRvIHRoZSByZXNvdXJjZSBzeW5jIGhvb2tzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL3N5bmMvc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IEZyb250ZW5kTW9kZWxTeW5jTXV0YXRpb25cbiAqL1xuXG4vKipcbiAqIFN5bmMgbXV0YXRpb24gYXV0aG9yaXphdGlvbiByZXN1bHQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb25cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gYWxsb3dlZCAtIFdoZXRoZXIgdGhlIG11dGF0aW9uIG1heSBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtyZWFzb25dIC0gU3RhYmxlIGZhaWx1cmUgcmVhc29uIGNvZGUgd2hlbiBkZW5pZWQuXG4gKi9cblxuLyoqXG4gKiBBcmd1bWVudHMgZm9yIHRoZSBhcHBseVN5bmMgZnVsbC1lc2NhcGUtaGF0Y2ggaG9vay5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxBcHBseVN5bmNBcmdzXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGV4aXN0aW5nU3luYyAtIEV4aXN0aW5nIHN5bmMgcm93IG9yIG51bGwuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IG11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gKi9cblxuLyoqXG4gKiBBcHBseSByZXN1bHQgcHJvZHVjZWQgYnkgcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNyZWF0ZWQgLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGVsZXRlZF0gLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBkZWxldGVkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IHJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gKi9cblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IG93bmluZyB0aGUgcmVzb3VyY2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogVHJhbnNwb3J0LXNhZmUgdmFsdWUgYWNjZXB0ZWQgaW4gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb24gcGF5bG9hZHMuXG4gKiBOZXN0ZWQgb2JqZWN0L2FycmF5IHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHNcbiAqIHJlY3Vyc2l2ZSBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgcGF5bG9hZCBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZVxuICovXG5cbi8qKlxuICogQXR0cmlidXRlIHBheWxvYWQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZT59IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWRcbiAqL1xuXG4vKipcbiAqIFZpcnR1YWwgc2V0dGVyIG1ldGhvZCBvbiBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlLlxuICogQHR5cGVkZWYgeyhhcmcxOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgYXJnMjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlKSA9PiAodm9pZCB8IFByb21pc2U8dm9pZD4pfSBGcm9udGVuZE1vZGVsUmVzb3VyY2VWaXJ0dWFsU2V0dGVyXG4gKi9cblxuLyoqXG4gKiBTdGF0aWMgaGVscGVycyB1c2VkIHdoZW4gY2hlY2tpbmcgd2hldGhlciBhIG1vZGVsLWxpa2UgcmVjZWl2ZXIgYWNjZXB0cyBhbiBhdHRyaWJ1dGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3NcbiAqIEBwcm9wZXJ0eSB7KGFyZzogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSByZXNvbHZlQXR0cmlidXRlTmFtZSAtIFJlc29sdmVzIGFsaWFzZXMgdG8gY2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZzE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXJnMjogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSBmaW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlIC0gTG9jYXRlcyBhIHNldHRlciBtZXRob2Qgb24gdGhlIHJlY2VpdmVyLlxuICovXG5cbi8qKlxuICogT3B0aW9ucyBwYXNzZWQgd2hpbGUgc2F2aW5nIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIG11dGF0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbYXR0YWNobWVudHNdIC0gVXBsb2FkZWQgYXR0YWNobWVudCBhdHRyaWJ1dGVzLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbH0gW2NvbnRyb2xsZXJdIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgbXV0YXRpb24uXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbbmVzdGVkQXR0cmlidXRlc10gLSBOZXN0ZWQgYXR0cmlidXRlcyBwYXlsb2FkLlxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkICYge2lkPzogc3RyaW5nIHwgbnVtYmVyLCBfZGVzdHJveT86IGJvb2xlYW4sIGF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBhdHRhY2htZW50cz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQsIG5lc3RlZEF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnlcbiAqL1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tlbmQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBbVE1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtURGF0YWJhc2VNb2RlbENsYXNzPUV4dHJhY3Q8VE1vZGVsQ2xhc3MsIHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD5dXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZXh0ZW5kcyBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHtcbiAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhYmlsaXRpZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRhY2htZW50cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbWVtYmVyQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHByaW1hcnlLZXkgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlcnZlckNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBzZXJ2ZXIgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgYm9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHN5bmMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gIHN0YXRpYyBTaGFyZWRSZXNvdXJjZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBEZWNsYXJhdGl2ZSB3cml0YWJsZS1hdHRyaWJ1dGUgcGVybWl0IGxpc3QgKGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZXMpXG4gICAqIHVzZWQgYXMgdGhlIGRlZmF1bHQge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UjcGVybWl0dGVkUGFyYW1zfSBhbmRcbiAgICogYXMgdGhlIHJvdXRlZCBzeW5jIHJlcGxheSBwZXJtaXQuIFJlc29sdmVkIHRocm91Z2ggdGhlIHNoYXJlZCByZXNvdXJjZVxuICAgKiBsaWtlIHRoZSBvdGhlciBzdGF0aWMgcmVzb3VyY2UgY29uZmlnOiBhbiB1bmRlY2xhcmVkIGVudmlyb25tZW50IGxpc3RcbiAgICogZmFsbHMgYmFjayB0byB0aGUgc2hhcmVkIHJlc291cmNlJ3MgbGlzdCwgd2hpbGUgYW4gZXhwbGljaXQgZGVjbGFyYXRpb25cbiAgICogKGluY2x1ZGluZyBgbnVsbGApIHdpbnMuXG4gICAqIEB0eXBlIHtzdHJpbmdbXSB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyB3cml0YWJsZUF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnczxGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzPiB8IEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzfSBhcmdzIC0gUmVzb3VyY2UgYXJncy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MpIHtcbiAgICBzdXBlcih7XG4gICAgICBhYmlsaXR5OiBcImFiaWxpdHlcIiBpbiBhcmdzID8gYXJncy5hYmlsaXR5IDogdW5kZWZpbmVkLFxuICAgICAgY29udGV4dDogXCJjb250ZXh0XCIgaW4gYXJncyA/IGFyZ3MuY29udGV4dCB8fCB7fSA6IHt9LFxuICAgICAgbG9jYWxzOiBcImxvY2Fsc1wiIGluIGFyZ3MgPyBhcmdzLmxvY2FscyB8fCB7fSA6IHt9XG4gICAgfSlcblxuICAgIC8vIE5hcnJvd3MgdGhlIHN1YmNsYXNzIHN0YXRpYyBzaWRlIHRvIHRoZSBtb2RlbCBjbGFzcyBjYXJyaWVkIGJ5IHRoaXMgcmVzb3VyY2UgZ2VuZXJpYy5cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSAmIHtNb2RlbENsYXNzOiBUTW9kZWxDbGFzcyB8IHVuZGVmaW5lZCwgbW9kZWxDbGFzczogKCkgPT4gVE1vZGVsQ2xhc3N9fSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBkZWZhdWx0UmVzb3VyY2VDb25maWd1cmF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovICh7YXR0cmlidXRlczogW119KVxuXG4gICAgdGhpcy5jb250cm9sbGVyID0gXCJjb250cm9sbGVyXCIgaW4gYXJncyA/IGFyZ3MuY29udHJvbGxlciA6IHVuZGVmaW5lZFxuICAgIHRoaXMuY29uZmlndXJhdGlvblZhbHVlID0gXCJjb25maWd1cmF0aW9uXCIgaW4gYXJncyA/IGFyZ3MuY29uZmlndXJhdGlvbiA6IHVuZGVmaW5lZFxuICAgIC8vIE5hcnJvd3MgYW4gZXhwbGljaXQgbW9kZWwgb3ZlcnJpZGUgdG8gdGhlIHJlc291cmNlIHN1YmNsYXNzJ3MgZGVjbGFyZWQgbW9kZWwgZ2VuZXJpYy5cbiAgICB0aGlzLm1vZGVsQ2xhc3NWYWx1ZSA9IC8qKiBAdHlwZSB7VE1vZGVsQ2xhc3N9ICovIChcIm1vZGVsQ2xhc3NcIiBpbiBhcmdzID8gYXJncy5tb2RlbENsYXNzIDogUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKCkpXG4gICAgdGhpcy5tb2RlbE5hbWVWYWx1ZSA9IFwibW9kZWxOYW1lXCIgaW4gYXJncyA/IGFyZ3MubW9kZWxOYW1lIDogdGhpcy5tb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICB0aGlzLnBhcmFtc1ZhbHVlID0gXCJwYXJhbXNcIiBpbiBhcmdzID8gYXJncy5wYXJhbXMgOiB1bmRlZmluZWRcbiAgICB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlID0gXCJyZXNvdXJjZUNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24gOiBkZWZhdWx0UmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25maWd1cmVkIHNoYXJlZCByZXNvdXJjZSBjbGFzcy5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNoYXJlZCByZXNvdXJjZSBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZUNsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLlNoYXJlZFJlc291cmNlXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBzdGF0aWMgcmVzb3VyY2UgY29uZmlnIHZhbHVlIGZyb20gdGhlIGVudmlyb25tZW50IHJlc291cmNlIGZpcnN0LFxuICAgKiB0aGVuIGZyb20gdGhlIHNoYXJlZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtcImFiaWxpdGllc1wiIHwgXCJhdHRhY2htZW50c1wiIHwgXCJhdHRyaWJ1dGVzXCIgfCBcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIgfCBcImNvbGxlY3Rpb25Db21tYW5kc1wiIHwgXCJjb21tYW5kc1wiIHwgXCJtZW1iZXJDb21tYW5kc1wiIHwgXCJtb2RlbE5hbWVcIiB8IFwicHJpbWFyeUtleVwiIHwgXCJyZWxhdGlvbnNoaXBzXCIgfCBcInNlcnZlclwiIHwgXCJzeW5jXCIgfCBcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIgfCBcIndyaXRhYmxlQXR0cmlidXRlc1wifSBuYW1lIC0gU3RhdGljIGNvbmZpZyBwcm9wZXJ0eSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gUmVzb2x2ZWQgY29uZmlnIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUobmFtZSkge1xuICAgIGlmICh0aGlzW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzW25hbWVdXG5cbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlQ2xhc3MoKSlcblxuICAgIGlmICghU2hhcmVkUmVzb3VyY2UpIHJldHVybiB1bmRlZmluZWRcbiAgICBpZiAoU2hhcmVkUmVzb3VyY2VbbmFtZV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIFNoYXJlZFJlc291cmNlW25hbWVdXG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdHJhbnNsYXRlZCBhdHRyaWJ1dGVzIGZyb20gZW52aXJvbm1lbnQgYW5kIHNoYXJlZCByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gLSBUcmFuc2xhdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyB0cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInRyYW5zbGF0ZWRBdHRyaWJ1dGVzXCIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGZyb250ZW5kLXNhZmUgYXR0YWNobWVudCBkZWNsYXJhdGlvbnMgZnJvbSB0aGUgYmFja2luZyBtb2RlbC5cbiAgICogUmVzb3VyY2UtbGV2ZWwgZGVjbGFyYXRpb25zIHJlbWFpbiBhcyBhIGZhbGxiYWNrIGZvciBmcm9udGVuZC1vbmx5IHJlc291cmNlcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gLSBDbGllbnQgYXR0YWNobWVudCBjb25maWd1cmF0aW9uIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgYXR0YWNobWVudENvbmZpZ3VyYXRpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRhY2htZW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb24+IHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0YWNobWVudHNcIikpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSBjb25maWd1cmVkQXR0YWNobWVudHMgPyB7Li4uY29uZmlndXJlZEF0dGFjaG1lbnRzfSA6IHt9XG5cbiAgICBpZiAoIXRoaXMuTW9kZWxDbGFzcykgcmV0dXJuIGF0dGFjaG1lbnRzXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgZGVmaW5pdGlvbl0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5Nb2RlbENsYXNzLmF0dGFjaG1lbnREZWZpbml0aW9ucygpKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudENvbmZpZyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb259ICovICh7dHlwZTogZGVmaW5pdGlvbi50eXBlfSlcblxuICAgICAgaWYgKGRlZmluaXRpb24uc3luYykgYXR0YWNobWVudENvbmZpZy5zeW5jID0gey4uLmRlZmluaXRpb24uc3luY31cblxuICAgICAgYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudENvbmZpZ1xuICAgIH1cblxuICAgIHJldHVybiBhdHRhY2htZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJlc291cmNlIGluc3RhbmNlIGZvciBzaGFyZWQtcmVzb3VyY2UgZmFsbGJhY2sgY2FsbHMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPiB8IG51bGx9IC0gU2hhcmVkIHJlc291cmNlIGluc3RhbmNlIHdoZW4gY29uZmlndXJlZC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlSW5zdGFuY2UoKSB7XG4gICAgaWYgKHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBTaGFyZWRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGU8VE1vZGVsQ2xhc3MsIFREYXRhYmFzZU1vZGVsQ2xhc3M+IHwgdW5kZWZpbmVkfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSB7XG4gICAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IG51bGxcbiAgICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuICAgIH1cblxuICAgIGlmIChTaGFyZWRSZXNvdXJjZSA9PT0gUmVzb3VyY2VDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke1Jlc291cmNlQ2xhc3MubmFtZX0uU2hhcmVkUmVzb3VyY2UgY2Fubm90IHBvaW50IHRvIGl0c2VsZi5gKVxuICAgIH1cblxuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gbmV3IFNoYXJlZFJlc291cmNlKHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMuY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MoKSxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5tb2RlbE5hbWUoKSxcbiAgICAgIHBhcmFtczogdGhpcy5wYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuICAgIH0pXG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSBzaGFyZWRSZXNvdXJjZVxuXG4gICAgcmV0dXJuIHNoYXJlZFJlc291cmNlXG4gIH1cblxuICAvKipcbiAgICogQ2FsbHMgYSBzaGFyZWQtcmVzb3VyY2UgbWV0aG9kIG9ubHkgd2hlbiB0aGUgc2hhcmVkIHJlc291cmNlIG92ZXJyaWRlcyB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHBhcmFtIHt1bmtub3duW119IGFyZ3MgLSBNZXRob2QgYXJncy5cbiAgICogQHJldHVybnMge3tjYWxsZWQ6IGJvb2xlYW4sIHJlc3VsdDogdW5rbm93bn19IC0gU2hhcmVkIG1ldGhvZCBjYWxsIHJlc3VsdC5cbiAgICovXG4gIGNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKSB7XG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cblxuICAgIGNvbnN0IG1ldGhvZE93bmVyID0gcHJvdG90eXBlT3duZXJGb3JNZXRob2Qoc2hhcmVkUmVzb3VyY2UsIG1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIW1ldGhvZE93bmVyIHx8IG1ldGhvZE93bmVyID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZSB8fCBtZXRob2RPd25lciA9PT0gQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZS5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybiB7Y2FsbGVkOiBmYWxzZSwgcmVzdWx0OiB1bmRlZmluZWR9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIHJldHVybiB7Y2FsbGVkOiB0cnVlLCByZXN1bHQ6IG1ldGhvZC5hcHBseShzaGFyZWRSZXNvdXJjZSwgYXJncyl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaGFyZWQgbWV0aG9kIHJlc3VsdCBvciBhIGZhbGxiYWNrIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gU2hhcmVkIG1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIFNoYXJlZCBtZXRob2QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBSZXN1bHR9IGZhbGxiYWNrIC0gRmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtSZXN1bHR9IC0gU2hhcmVkIG9yIGZhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlTWV0aG9kT3IobWV0aG9kTmFtZSwgYXJncywgZmFsbGJhY2spIHtcbiAgICBjb25zdCBzaGFyZWRSZXN1bHQgPSB0aGlzLmNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKVxuXG4gICAgaWYgKHNoYXJlZFJlc3VsdC5jYWxsZWQpIHJldHVybiAvKiogQHR5cGUge1Jlc3VsdH0gKi8gKHNoYXJlZFJlc3VsdC5yZXN1bHQpXG5cbiAgICByZXR1cm4gZmFsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgbWV0aG9kIG9uIHRoaXMgcmVzb3VyY2Ugb3IgaXRzIHNoYXJlZCBmYWxsYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ttZXRob2Q6ICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24sIHJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFRNb2RlbENsYXNzLCBURGF0YWJhc2VNb2RlbENsYXNzPn0gfCBudWxsfSAtIFJlc29sdmVkIG1ldGhvZCBhbmQgcmVjZWl2ZXIuXG4gICAqL1xuICByZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lKSB7XG4gICAgY29uc3Qgb3duTWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMpKVttZXRob2ROYW1lXVxuXG4gICAgaWYgKHR5cGVvZiBvd25NZXRob2QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbWV0aG9kOiAvKiogQHR5cGUgeyguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd259ICovIChvd25NZXRob2QpLFxuICAgICAgICByZXNvdXJjZTogdGhpc1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNoYXJlZFJlc291cmNlID0gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlKClcblxuICAgIGlmICghc2hhcmVkUmVzb3VyY2UpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzaGFyZWRNZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc2hhcmVkUmVzb3VyY2UpKVttZXRob2ROYW1lXVxuXG4gICAgaWYgKHR5cGVvZiBzaGFyZWRNZXRob2QgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBtZXRob2Q6IC8qKiBAdHlwZSB7KC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bn0gKi8gKHNoYXJlZE1ldGhvZCksXG4gICAgICByZXNvdXJjZTogc2hhcmVkUmVzb3VyY2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhYmlsaXRpZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFiaWxpdGllcygpIHtcbiAgICB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhYmlsaXRpZXNcIiwgW10sICgpID0+IHVuZGVmaW5lZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHR5cGVkIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAtIENvbnRyb2xsZXIgaW5zdGFuY2Ugd2l0aCBmcm9udGVuZC1tb2RlbCBoZWxwZXJzLlxuICAgKi9cbiAgdHlwZWRDb250cm9sbGVySW5zdGFuY2UoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gKi8gKHRoaXMuY29udHJvbGxlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBTdGF0aWMgcmVzb3VyY2UgY29uZmlnIChyYXcgdXNlciBpbnB1dCBzaGFwZTsgY29uc3VtZXJzIG5vcm1hbGl6ZSkuXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VDb25maWcoKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImF0dHJpYnV0ZXNcIilcbiAgICBjb25zdCBhYmlsaXRpZXMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhYmlsaXRpZXNcIilcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHRoaXMuYXR0YWNobWVudENvbmZpZ3VyYXRpb25zKClcbiAgICBjb25zdCBjb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImNvbW1hbmRzXCIpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIilcbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIilcbiAgICBjb25zdCBjb2xsZWN0aW9uQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJjb2xsZWN0aW9uQ29tbWFuZHNcIilcbiAgICBjb25zdCBtZW1iZXJDb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1lbWJlckNvbW1hbmRzXCIpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibW9kZWxOYW1lXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInByaW1hcnlLZXlcIilcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwicmVsYXRpb25zaGlwc1wiKVxuICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInNlcnZlclwiKVxuICAgIGNvbnN0IHN5bmMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzeW5jXCIpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovXG4gICAgY29uc3QgY29uZmlnID0ge1xuICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBzdHJpbmdbXX0gKi8gKGF0dHJpYnV0ZXMgfHwgW10pXG4gICAgfVxuXG4gICAgaWYgKGFiaWxpdGllcykgY29uZmlnLmFiaWxpdGllcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhYmlsaXRpZXMpXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBjb25maWcuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChjb21tYW5kcykgY29uZmlnLmNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbW1hbmRzKVxuICAgIGlmIChidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzKVxuICAgIGlmIChidWlsdEluTWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKVxuICAgIGlmIChjb2xsZWN0aW9uQ29tbWFuZHMpIGNvbmZpZy5jb2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoY29sbGVjdGlvbkNvbW1hbmRzKVxuICAgIGlmIChtZW1iZXJDb21tYW5kcykgY29uZmlnLm1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKG1lbWJlckNvbW1hbmRzKVxuICAgIGlmIChtb2RlbE5hbWUpIGNvbmZpZy5tb2RlbE5hbWUgPSAvKiogQHR5cGUge3N0cmluZ30gKi8gKG1vZGVsTmFtZSlcbiAgICBpZiAocHJpbWFyeUtleSkgY29uZmlnLnByaW1hcnlLZXkgPSAvKiogQHR5cGUge3N0cmluZ30gKi8gKHByaW1hcnlLZXkpXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMpIGNvbmZpZy5yZWxhdGlvbnNoaXBzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKHJlbGF0aW9uc2hpcHMpXG4gICAgaWYgKHNlcnZlcikgY29uZmlnLnNlcnZlciA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTZXJ2ZXJDb25maWd1cmF0aW9ufSAqLyAoc2VydmVyKVxuICAgIGlmIChzeW5jICE9PSB1bmRlZmluZWQpIGNvbmZpZy5zeW5jID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uIHwgYm9vbGVhbn0gKi8gKHN5bmMpXG5cbiAgICByZXR1cm4gY29uZmlnXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb250cm9sbGVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0fSAtIENvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqL1xuICBjb250cm9sbGVySW5zdGFuY2UoKSB7XG4gICAgaWYgKCF0aGlzLmNvbnRyb2xsZXIpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgY29udHJvbGxlciBpbnN0YW5jZS5gKVxuXG4gICAgcmV0dXJuIHRoaXMuY29udHJvbGxlclxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIFZlbG9jaW91cyBjb25maWd1cmF0aW9uOiB0aGUgY29udHJvbGxlcidzIHdoZW4gdGhlIHJlc291cmNlXG4gICAqIHNlcnZlcyBhIGNvbnRyb2xsZXIgcmVxdWVzdCwgb3RoZXJ3aXNlIHRoZSBjb25zdHJ1Y3Rvci1pbmplY3RlZFxuICAgKiBjb25maWd1cmF0aW9uIChmb3IgZXhhbXBsZSBhIHN5bmMgd2Vic29ja2V0IGNoYW5uZWwncyByZXNvdXJjZSkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBjb25maWd1cmF0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRyb2xsZXIpIHJldHVybiB0aGlzLmNvbnRyb2xsZXJJbnN0YW5jZSgpLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGlmICh0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZSkgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvblZhbHVlXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIGNvbnRyb2xsZXIgb3IgYW4gaW5qZWN0ZWQgY29uZmlndXJhdGlvbi5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gLSBNb2RlbCBjbGFzcy5cbiAgICovXG4gIG1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsQ2xhc3NWYWx1ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBtb2RlbCBjbGFzcy5gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3NWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRhdGFiYXNlIG1vZGVsIGNsYXNzIHVzZWQgYnkgc2VydmVyLW9ubHkgcmVzb3VyY2Ugb3BlcmF0aW9ucy5cbiAgICogQHJldHVybnMge1REYXRhYmFzZU1vZGVsQ2xhc3N9IC0gRGF0YWJhc2UgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBkYXRhYmFzZU1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLmlzQmFja2VuZCgpKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSBkYXRhYmFzZSBvcGVyYXRpb25zIHJlcXVpcmUgdGhlIGJhY2tlbmQgcmVzb3VyY2UgcnVudGltZS5gKVxuXG4gICAgLy8gTmFycm93cyB0aGUgcG9ydGFibGUgcmVzb3VyY2UgZ2VuZXJpYyBhdCB0aGUgZXhwbGljaXQgYmFja2VuZC1vcGVyYXRpb24gYm91bmRhcnkuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VERhdGFiYXNlTW9kZWxDbGFzc30gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHRoaXMubW9kZWxDbGFzcygpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmVkIG1vZGVsIGNsYXNzIGZvciBhdXRob3JpemF0aW9uIGhlbHBlcnMuXG4gICAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgcmVxdWlyZWRNb2RlbENsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNb2RlbCBuYW1lLlxuICAgKi9cbiAgbW9kZWxOYW1lKCkge1xuICAgIGlmICghdGhpcy5tb2RlbE5hbWVWYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBtb2RlbCBuYW1lLmApXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbE5hbWVWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IC0gUGFyYW1zLlxuICAgKi9cbiAgcGFyYW1zKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gKi8gKHRoaXMucGFyYW1zVmFsdWUgfHwgc3VwZXIucGFyYW1zKCkgfHwge30pIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBSZXNvdXJjZSBjb25maWcgKG5vcm1hbGl6ZWQgYXQgcnVudGltZTsgcmF3IGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICAgKi9cbiAgcmVzb3VyY2VDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSByZXNvdXJjZSBjb25maWd1cmF0aW9uLmApXG5cbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBSYWlscy1zdHJvbmctcGFyYW1zIC8gYXBpX21ha2VyLXN0eWxlIHBlcm1pdCBzcGVjIGRlY2xhcmluZ1xuICAgKiB3aGljaCBhdHRyaWJ1dGVzIGFuZCBuZXN0ZWQgYXR0cmlidXRlcyBhcmUgd3JpdGFibGUgZm9yIHRoZSBjdXJyZW50XG4gICAqIHJlcXVlc3QuIFN1Ym1pdHRpbmcgYW4gYXR0cmlidXRlIG9yIG5lc3RlZC1yZWxhdGlvbnNoaXAga2V5IHRoYXQgaXNcbiAgICogbm90IHBlcm1pdHRlZCByYWlzZXMgYW4gZXJyb3IgYW5kIGZhaWxzIHRoZSB3cml0ZS5cbiAgICpcbiAgICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgZmxhdCBhcnJheSB0aGF0IG1peGVzOlxuICAgKiAgIC0gYFwiYXR0cmlidXRlTmFtZVwiYCBzdHJpbmdzIGZvciBwbGFpbiBhdHRyaWJ1dGUgd3JpdGVzXG4gICAqICAgLSBgezxyZWxhdGlvbnNoaXBOYW1lPkF0dHJpYnV0ZXM6IFsuLi5dfWAgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWVcbiAgICogICAgIGlzIGl0c2VsZiBhIHBlcm1pdCBzcGVjIGZvciB0aGUgbmVzdGVkIHJlbGF0aW9uc2hpcFxuICAgKlxuICAgKiBUaGlzIG1hdGNoZXMgUmFpbHMgc3Ryb25nX3BhcmFtcyAoYHBlcm1pdCg6Zmlyc3RfbmFtZSwgOmxhc3RfbmFtZSxcbiAgICogY29udGFjdF9hdHRyaWJ1dGVzOiBbOmVtYWlsLCBkZXRhaWxzX2F0dHJpYnV0ZXM6IFs6ZGV0YWlsXV0pYCkgYW5kXG4gICAqIHRoZSBhcGlfbWFrZXIgc2lzdGVyIHByb2plY3QuIEluY2x1ZGUgYFwiX2Rlc3Ryb3lcImAgaW5zaWRlIGEgbmVzdGVkXG4gICAqIHBlcm1pdCB0byBhbGxvdyBgX2Rlc3Ryb3k6IHRydWVgIGVudHJpZXMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlFxuICAgKiB0aGUgbW9kZWwgbXVzdCBhbHNvIGRlY2xhcmUgYGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUsXG4gICAqIHthbGxvd0Rlc3Ryb3k6IHRydWV9KWAgZm9yIHRoZSBkZXN0cm95IHRvIGJlIGFwcGxpZWQuXG4gICAqXG4gICAqIEV4YW1wbGU6XG4gICAqXG4gICAqICAgY2xhc3MgUHJvamVjdFJlc291cmNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gICAqICAgICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAqICAgICAgIHJldHVybiBbXG4gICAqICAgICAgICAgXCJuYW1lXCIsXG4gICAqICAgICAgICAgXCJkZXNjcmlwdGlvblwiLFxuICAgKiAgICAgICAgIHt0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCIsXG4gICAqICAgICAgICAgICB7c3VidGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAgICogICAgICAgICBdfVxuICAgKiAgICAgICBdXG4gICAqICAgICB9XG4gICAqICAgfVxuICAgKlxuICAgKiBEZWZhdWx0IGltcGxlbWVudGF0aW9uIHJldHVybnMgdGhlIGRlY2xhcmVkXG4gICAqIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLndyaXRhYmxlQXR0cmlidXRlc30gcGVybWl0IGxpc3QsIG9yIGBbXWBcbiAgICog4oCUIG5vdGhpbmcgcGVybWl0dGVkIOKAlCB3aXRob3V0IGEgZGVjbGFyZWQgbGlzdC4gU3ViY2xhc3NlcyBvdmVycmlkZSB0b1xuICAgKiBjdXN0b21pemU7IGFuIGV4cGxpY2l0IG92ZXJyaWRlIGFsd2F5cyB3aW5zLlxuICAgKiBAcGFyYW0ge3thY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhYmlsaXR5PzogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQsIGxvY2Fscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmddIC0gUmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQZXJtaXQgc3BlYy5cbiAgICovXG4gIHBlcm1pdHRlZFBhcmFtcyhhcmcpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwicGVybWl0dGVkUGFyYW1zXCIsIFthcmddLCAoKSA9PiB7XG4gICAgICB2b2lkIGFyZ1xuXG4gICAgICByZXR1cm4gdGhpcy5kZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpID8/IFtdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGVjbGFyZWQgd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0IGZyb20gdGhlIGVudmlyb25tZW50XG4gICAqIHJlc291cmNlIGZpcnN0LCB0aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ug4oCUIG1pcnJvcmluZyBob3cgdGhlIG90aGVyXG4gICAqIHN0YXRpYyByZXNvdXJjZSBjb25maWcgcmVzb2x2ZXMuIEFuIGV4cGxpY2l0IGVudmlyb25tZW50IGRlY2xhcmF0aW9uXG4gICAqIChpbmNsdWRpbmcgYG51bGxgKSB3aW5zIG92ZXIgdGhlIHNoYXJlZCByZXNvdXJjZSdzIGxpc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IERlY2xhcmVkIHBlcm1pdCBsaXN0IG9yIG51bGwgd2hlbiB1bmRlY2xhcmVkLlxuICAgKi9cbiAgZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHBlcm1pdHRlZEF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIndyaXRhYmxlQXR0cmlidXRlc1wiKSlcblxuICAgIHJldHVybiBwZXJtaXR0ZWRBdHRyaWJ1dGVzID8/IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNsaWVudC1zYWZlIGVycm9yIHRocm93biBmb3IgYSBmYWlsZWQgd3JpdGFibGUtYXR0cmlidXRlIHZhbGlkYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gSHVtYW4tcmVhZGFibGUgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tjYXVzZT86IEVycm9yLCBjb2RlOiBzdHJpbmd9fSBkZXRhaWxzIC0gU3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgY29kZSBhbmQgb3B0aW9uYWwgY2F1c2UuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gQ2xpZW50LXNhZmUgZXJyb3IuXG4gICAqL1xuICB3cml0YWJsZUF0dHJpYnV0ZUVycm9yKG1lc3NhZ2UsIHtjYXVzZSwgY29kZX0pIHtcbiAgICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShtZXNzYWdlLCBjYXVzZSA/IHtjYXVzZSwgY29kZX0gOiB7Y29kZX0pXG4gIH1cblxuICAvKipcbiAgICogQXV0aG9yaXplcyBvbmUgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIGJlZm9yZSBpdCBpcyBhcHBsaWVkLlxuICAgKiBEZWZhdWx0cyB0byBhbGxvd2luZyBldmVyeSBtdXRhdGlvbjsgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24gc3RpbGxcbiAgICogYXBwbGllcyB0aHJvdWdoIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlI2ZpbmRTeW5jUmVjb3JkfSBzY29waW5nXG4gICAqIGFuZCB0aGUgY3JlYXRlIG1lbWJlcnNoaXAgY2hlY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbiB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uPn0gQXV0aG9yaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhdXRob3JpemVTeW5jTXV0YXRpb24oe2NvbnRleHQsIG11dGF0aW9ufSkge1xuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgbXV0YXRpb25cblxuICAgIHJldHVybiB7YWxsb3dlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBwZXItc3luYyBmYWlsdXJlIHJlYXNvbiByZXBvcnRlZCB3aGVuIGEgcm91dGVkIHN5bmMgbXV0YXRpb25cbiAgICogZmFpbHMgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24uIERlZmF1bHRzIHRvIG51bGwsIHdoaWNoIHJlcG9ydHMgdGhlXG4gICAqIGdlbmVyaWMgXCJhY2Nlc3MtZGVuaWVkXCIgcmVhc29uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gYXJncy5hY3Rpb24gLSBEZW5pZWQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFN0YWJsZSBmYWlsdXJlIHJlYXNvbiBjb2RlIG9yIG51bGwgZm9yIHRoZSBnZW5lcmljIGRlZmF1bHQuXG4gICAqL1xuICBzeW5jQXV0aG9yaXphdGlvbkZhaWx1cmVSZWFzb24oe2FjdGlvbiwgbXV0YXRpb259KSB7XG4gICAgdm9pZCBhY3Rpb25cbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBleGlzdGluZyByZWNvcmQgdGFyZ2V0ZWQgYnkgYSByb3V0ZWQgc3luYyByZXBsYXkgbXV0YXRpb24uXG4gICAqIERlZmF1bHRzIHRvIGFuIGBhY2Nlc3NpYmxlRm9yYCBsb29rdXAgYnkgcHJpbWFyeSBrZXkgdGhyb3VnaCB0aGVcbiAgICogcmVzb3VyY2UncyBub3JtYWxpemVkIGFiaWxpdHkgYWN0aW9uIGZvciB1cGRhdGUgKG9yIGRlc3Ryb3kgZm9yIGRlbGV0ZVxuICAgKiBtdXRhdGlvbnMpLCBmYWxsaW5nIGJhY2sgdG8gYW4gdW5zY29wZWQgbG9va3VwIHdpdGhvdXQgYW4gYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYXJncy5hYmlsaXR5XSAtIEFiaWxpdHkgb3ZlcnJpZGUuIERlZmF1bHRzIHRvIHRoZSByZXNvdXJjZSBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmZvckRlbGV0ZV0gLSBXaGV0aGVyIHRoZSBsb29rdXAgaXMgZm9yIGEgZGVsZXRlIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gRXhpc3RpbmcgcmVjb3JkIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBmaW5kU3luY1JlY29yZCh7YWJpbGl0eSA9IHRoaXMuYWJpbGl0eSwgZm9yRGVsZXRlID0gZmFsc2UsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcXVlcnkgPSBhYmlsaXR5XG4gICAgICA/IE1vZGVsQ2xhc3MuYWNjZXNzaWJsZUZvcih0aGlzLnN5bmNBYmlsaXR5QWN0aW9uKGZvckRlbGV0ZSA/IFwiZGVzdHJveVwiIDogXCJ1cGRhdGVcIiksIGFiaWxpdHkpXG4gICAgICA6IE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZmluZEJ5KHtbcHJpbWFyeUtleV06IG11dGF0aW9uLnJlc291cmNlSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcHMgYSByYXcgc3luYyBhY3Rpb24gdG8gdGhlIHJlc291cmNlJ3Mgbm9ybWFsaXplZCBhYmlsaXR5IGFjdGlvbiB3aGVuXG4gICAqIHRoZSByZXNvdXJjZSBjb25maWd1cmF0aW9uIGRlY2xhcmVzIGFuIGFiaWxpdGllcyBtYXBwaW5nLCBvdGhlcndpc2UgdGhlXG4gICAqIHJhdyBhY3Rpb24gbmFtZSBpcyB1c2VkIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGFjdGlvbiAtIFJhdyBzeW5jIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gQWJpbGl0eSBhY3Rpb24uXG4gICAqL1xuICBzeW5jQWJpbGl0eUFjdGlvbihhY3Rpb24pIHtcbiAgICBjb25zdCBhYmlsaXRpZXMgPSB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlPy5hYmlsaXRpZXNcblxuICAgIGlmIChhYmlsaXRpZXMgJiYgdHlwZW9mIGFiaWxpdGllcyA9PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFiaWxpdGllcylbYWN0aW9uXVxuXG4gICAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gPT0gXCJzdHJpbmdcIiAmJiBhYmlsaXR5QWN0aW9uLmxlbmd0aCA+IDApIHJldHVybiBhYmlsaXR5QWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIGFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZ1bGwgZXNjYXBlIGhhdGNoIGZvciByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi4gUmV0dXJuaW5nIGFcbiAgICogbm9uLW51bGwgcmVzdWx0IHJlcGxhY2VzIHRoZSB3aG9sZSBkZWZhdWx0IGFwcGx5IGZsb3cgKGF1dGhvcml6YXRpb24sXG4gICAqIHJlY29yZCBsb29rdXAsIG5vcm1hbGl6YXRpb24gYW5kIHNhdmUpIHdpdGggdGhlIHJldHVybmVkIGFwcGx5IHJlc3VsdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXBwbHlTeW5jQXJnc30gYXJncyAtIEFwcGx5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0IHwgbnVsbCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGw+fSBBcHBseSByZXN1bHQgb3IgbnVsbCBmb3IgdGhlIGRlZmF1bHQgZmxvdy5cbiAgICovXG4gIGFwcGx5U3luYyhhcmdzKSB7XG4gICAgdm9pZCBhcmdzXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgYSByb3V0ZWQgc3luYyBtdXRhdGlvbiB3YXMgYXBwbGllZC4gUmV0dXJuZWQgZW50cmllcyBhcmVcbiAgICogbWVyZ2VkIGludG8gdGhlIGFwcGx5IHJlc3VsdCwgcmVhY2hpbmcgcGVyc2lzdEV4dHJhQXR0cmlidXRlcyBhbmRcbiAgICogYnJvYWRjYXN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jcmVhdGVkIC0gV2hldGhlciB0aGUgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGFyZ3MucmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gRXh0cmEgYXBwbHktcmVzdWx0IGVudHJpZXMuXG4gICAqL1xuICBhZnRlclN5bmNBcHBseSh7Y29udGV4dCwgY3JlYXRlZCwgbXV0YXRpb24sIHJlY29yZH0pIHtcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIGNyZWF0ZWRcbiAgICB2b2lkIG11dGF0aW9uXG4gICAgdm9pZCByZWNvcmRcblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY3JlYXRlIGF0dHJpYnV0ZXMgYmVmb3JlIHBlcm1pc3Npb24gZmlsdGVyaW5nIGFuZCBzYXZpbmcuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIEluY29taW5nIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZD59IC0gTm9ybWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcIm5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXNcIiwgW2F0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgdXBkYXRlIGF0dHJpYnV0ZXMgYmVmb3JlIHBlcm1pc3Npb24gZmlsdGVyaW5nIGFuZCBzYXZpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIEluY29taW5nIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZD59IC0gTm9ybWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVVcGRhdGVBdHRyaWJ1dGVzXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgb3B0aW9uc1xuXG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgY3JlYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE5ldyBtb2RlbCBiZWZvcmUgYXNzaWdubWVudC9zYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZUNyZWF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVDcmVhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgY3JlYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIENyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJDcmVhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbCBiZWZvcmUgYXNzaWdubWVudC9zYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZVVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVVcGRhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJVcGRhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVEZXN0cm95XCIsIFttb2RlbF0sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBEZXN0cm95ZWQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJEZXN0cm95KG1vZGVsKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXcmFwcyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgcmVzb3VyY2UgbXV0YXRpb25zLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gYXJncy5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIE11dGF0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE11dGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXN1bHQ+fSBhcmdzLmNhbGxiYWNrIC0gTXV0YXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTXV0YXRpb25UcmFuc2FjdGlvbih7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcInJ1bk11dGF0aW9uVHJhbnNhY3Rpb25cIiwgW3thY3Rpb24sIG1vZGVsLCBjYWxsYmFja31dLCBhc3luYyAoKSA9PiB7XG4gICAgICB2b2lkIGFjdGlvblxuICAgICAgdm9pZCBtb2RlbFxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQcmltYXJ5IGtleS5cbiAgICovXG4gIHByaW1hcnlLZXkoKSB7IHJldHVybiB0aGlzLm1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9ufSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIGF1dGhvcml6ZWRRdWVyeShhY3Rpb24pIHtcbiAgICAvLyBOYXJyb3dzIHRoZSBjb250cm9sbGVyIHF1ZXJ5IHRvIHRoaXMgcmVzb3VyY2UncyBtb2RlbCBjbGFzcy5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFREYXRhYmFzZU1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59IC0gRnJvbnRlbmQtbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqL1xuICBpbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VERhdGFiYXNlTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEluZGV4UXVlcnkoe1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBwYWdpbmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYWdpbmF0aW9ufSBhcmdzLnBhZ2luYXRpb24gLSBQYWdpbmF0aW9uIHBhcmFtcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4UGFnaW5hdGlvbih7Y29udHJvbGxlciwgcGFnaW5hdGlvbiwgcXVlcnl9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtwYWdpbmF0aW9uLCBxdWVyeX0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBzZWFyY2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlciwgcXVlcnksIHNlYXJjaH0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaCh7cXVlcnksIHNlYXJjaH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBmcm9udGVuZC1tb2RlbCBpbmRleCBzb3J0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNvcnQgYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9IGFyZ3Muc29ydCAtIFNvcnQgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydCh7Y29udHJvbGxlciwgcXVlcnksIHNvcnR9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTb3J0KHtxdWVyeSwgc29ydH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBwbHVjay5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBwbHVjayBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c1BsdWNrKGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLnJlY29yZHMgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLnJlY29yZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIGNvdW50LlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGNvdW50IGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzQ291bnQoYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykucmVjb3JkcyA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUucmVjb3JkcyB8fFxuICAgICAgT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLmNvdW50ICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5jb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IHZvaWQgfCBQcm9taXNlPGJvb2xlYW4gfCB2b2lkPn0gLSBDb250aW51ZSBwcm9jZXNzaW5nIHVubGVzcyBmYWxzZS5cbiAgICovXG4gIGJlZm9yZUFjdGlvbihhY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQWN0aW9uXCIsIFthY3Rpb25dLCAoKSA9PiB7XG4gICAgICB2b2lkIGFjdGlvblxuXG4gICAgICAvLyBOby1vcCBieSBkZWZhdWx0LlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBSZWNvcmRzIGZvciBpbmRleCBhY3Rpb24uXG4gICAqL1xuICBhc3luYyByZWNvcmRzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmluZGV4UXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5IG9wdGlvbnMgZm9yIGNvdW50LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnN9IC0gSW5kZXggcXVlcnkgb3B0aW9ucyBmb3IgY291bnQuXG4gICAqL1xuICBjb3VudEluZGV4UXVlcnlPcHRpb25zKCkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVjb3JkcyBjb3VudCBmb3IgaW5kZXggYWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgY291bnQoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5kZXhRdWVyeSh0aGlzLmNvdW50SW5kZXhRdWVyeU9wdGlvbnMoKSkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZC5cbiAgICogQHBhcmFtIHtcImZpbmRcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBpZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBMb2NhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgZmluZChhY3Rpb24sIGlkKSB7XG4gICAgbGV0IHF1ZXJ5ID0gdGhpcy5hdXRob3JpemVkUXVlcnkoYWN0aW9uKVxuICAgIGNvbnN0IHByZWxvYWQgPSBhY3Rpb24gPT09IFwiZmluZFwiID8gdGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxQcmVsb2FkKCkgOiBudWxsXG5cbiAgICBpZiAocHJlbG9hZCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHByZWxvYWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeSh7W3RoaXMucHJpbWFyeUtleSgpXTogaWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBDcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQ3JlYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRTcGxpdCA9IHRoaXMuX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsKVxuICAgIGNvbnN0IHBlcm1pdCA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwiY3JlYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiBub3JtYWxpemVkQXR0cmlidXRlc30pKVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLmRhdGFiYXNlTW9kZWxDbGFzcygpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKE1vZGVsQ2xhc3MucHJvdG90eXBlLCBNb2RlbENsYXNzLCBhdHRhY2htZW50U3BsaXQuYXR0cmlidXRlcywgdGhpcywgcGVybWl0LmF0dHJpYnV0ZXMpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJjcmVhdGVcIixcbiAgICAgIG1vZGVsLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWZvcmVDcmVhdGUobW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgICAgICBjb25zdCBzYXZlZE1vZGVsID0gYXdhaXQgdGhpcy5fc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnM6IHsuLi5vcHRpb25zLCBhdHRhY2htZW50czogYXR0YWNobWVudFNwbGl0LmF0dGFjaG1lbnRzfSwgcGVybWl0fSlcblxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyQ3JlYXRlKHNhdmVkTW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuXG4gICAgICAgIHJldHVybiBzYXZlZE1vZGVsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB1bmF1dGhvcml6ZWQgY3JlYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDbGVhbnVwIGFmdGVyIGZhaWxlZCBhdXRob3JpemF0aW9uLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlVW5hdXRob3JpemVkQ3JlYXRlZE1vZGVsKG1vZGVsKSB7XG4gICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIFVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBVcGRhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwsIG1vZGVsLmdldE1vZGVsQ2xhc3MoKSwgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlVXBkYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclVwZGF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgYSBtb2RlbCBhbmQgYXBwbGllcyBuZXN0ZWQgYXR0cmlidXRlcyBpbiBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7e2ZpbHRlcmVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG1vZGVsOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgb3B0aW9uczogRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnMsIHBlcm1pdDoge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19fSBhcmdzIC0gU2F2ZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBTYXZlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9ucywgcGVybWl0fSkge1xuICAgIGF3YWl0IHRoaXMuZGF0YWJhc2VNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKG1vZGVsLCBmaWx0ZXJlZClcbiAgICAgIHRoaXMuX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgICBpZiAob3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhtb2RlbCwgb3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmNvbnRyb2xsZXIgfHwgbnVsbCwgcGVybWl0KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtb2RlbC5zYXZlKClcblxuICAgICAgaWYgKG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMobW9kZWwsIG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcywgb3B0aW9ucy5jb250cm9sbGVyIHx8IG51bGwsIHBlcm1pdClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fcHJlbG9hZE5lc3RlZFdyaXRhYmxlUmVsYXRpb25zaGlwcyhtb2RlbCwgcGVybWl0KVxuXG4gICAgcmV0dXJuIG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBhdHRyaWJ1dGVzIHRvIGEgbW9kZWwsIHVzaW5nIHZpcnR1YWwgc2V0dGVycyBvbiB0aGUgcmVzb3VyY2Ugd2hlbiBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhtb2RlbCwgYXR0cmlidXRlcykge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGRpcmVjdEF0dHJpYnV0ZXMgPSB7fVxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldChSZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW10pXG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUobmFtZSl9QXR0cmlidXRlYFxuICAgICAgY29uc3QgcmVzb3VyY2VTZXR0ZXIgPSB0aGlzLnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgICAgaWYgKHJlc291cmNlU2V0dGVyKSB7XG4gICAgICAgIGF3YWl0IHJlc291cmNlU2V0dGVyLm1ldGhvZC5jYWxsKHJlc291cmNlU2V0dGVyLnJlc291cmNlLCBtb2RlbCwgdmFsdWUpXG4gICAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKG5hbWUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpcmVjdEF0dHJpYnV0ZXNbbmFtZV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhkaXJlY3RBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBtb2RlbC5hc3NpZ24oZGlyZWN0QXR0cmlidXRlcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU3BsaXRzIGF0dGFjaG1lbnQtbmFtZWQgYXR0cmlidXRlcyBpbnRvIHRoZSBhdHRhY2htZW50IHBheWxvYWQgd2hpbGUgcHJlc2VydmluZyBsZWdhY3kgY2FsbGVyc1xuICAgKiB0aGF0IHN1Ym1pdHRlZCBhdHRhY2htZW50cyBhcyBub3JtYWwgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gRXhwbGljaXQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXR0YWNobWVudHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9fSBBdHRyaWJ1dGVzIHdpdGggYXR0YWNobWVudCBrZXlzIHJlbW92ZWQgYW5kIG1lcmdlZCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqL1xuICBfZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzKSB7XG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gdGhpcy5tb2RlbENsYXNzKCkuYXR0YWNobWVudERlZmluaXRpb25zKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dGFjaG1lbnREZWZpbml0aW9ucykpXG5cbiAgICBpZiAoYXR0YWNobWVudE5hbWVzLnNpemUgPT09IDApIHJldHVybiB7YXR0cmlidXRlcywgYXR0YWNobWVudHN9XG5cbiAgICBpZiAoYXR0YWNobWVudHMgIT09IG51bGwgJiYgIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVndWxhckF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gKi9cbiAgICBsZXQgbWVyZ2VkQXR0YWNobWVudHMgPSBhdHRhY2htZW50cyA/IHsuLi5hdHRhY2htZW50c30gOiBudWxsXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0YWNobWVudE5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICByZWd1bGFyQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWVyZ2VkQXR0YWNobWVudHMpIG1lcmdlZEF0dGFjaG1lbnRzID0ge31cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobWVyZ2VkQXR0YWNobWVudHMsIGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAnJHthdHRyaWJ1dGVOYW1lfScgd2FzIHN1Ym1pdHRlZCBpbiBib3RoIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzLmApXG4gICAgICB9XG5cbiAgICAgIG1lcmdlZEF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4ge2F0dHJpYnV0ZXM6IHJlZ3VsYXJBdHRyaWJ1dGVzLCBhdHRhY2htZW50czogbWVyZ2VkQXR0YWNobWVudHN9XG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGF0dGFjaG1lbnQgcGF5bG9hZHMgb24gYSBtb2RlbCBhZnRlciB2YWxpZGF0aW5nIHBlcm1pdHMgYW5kIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgcmVjZWl2aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gQXR0YWNobWVudHMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyAtIEF0dHJpYnV0ZS9hdHRhY2htZW50IG5hbWVzIHBlcm1pdHRlZCBieSB0aGUgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBhdHRhY2htZW50cywgcGVybWl0dGVkQXR0cmlidXRlTmFtZXMpIHtcbiAgICBpZiAoIWF0dGFjaG1lbnRzKSByZXR1cm5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICBjb25zdCBwZXJtaXRTZXQgPSBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbC5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBtb2RlbENsYXNzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzID0gW11cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGludmFsaWRBdHRhY2htZW50cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgaWYgKCFwZXJtaXRTZXQuaGFzKGF0dGFjaG1lbnROYW1lKSkge1xuICAgICAgICBub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbnNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICAgIGludmFsaWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5xdWV1ZUF0dGFjaCh2YWx1ZSlcbiAgICB9XG5cbiAgICBpZiAobm90UGVybWl0dGVkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgRnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lcyBub3QgcGVybWl0dGVkIGJ5IHBlcm1pdHRlZFBhcmFtcygpOiAke25vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gICAgfVxuICAgIGlmIChpbnZhbGlkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgSW52YWxpZCBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IG5hbWVzOiAke2ludmFsaWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgb24gYSBtb2RlbCB2aWEgdGhlIHRyYW5zbGF0aW9ucyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSB2YWx1ZSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29udGV4dD8uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGxvY2FsZSA9IGNvbmZpZ3VyYXRpb24gPyBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpIDogXCJlblwiXG4gICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRyYW5zbGF0aW9uXG5cbiAgICBpZiAobW9kZWwuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChcInRyYW5zbGF0aW9uc1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgIHRyYW5zbGF0aW9uID0gbG9hZGVkLmZpbmQoKHQpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodCkubG9jYWxlKCkgPT09IGxvY2FsZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXRyYW5zbGF0aW9uKSB7XG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0ge31cblxuICAgIGFzc2lnbm1lbnRzW25hbWVdID0gdmFsdWVcbiAgICB0cmFuc2xhdGlvbi5hc3NpZ24oYXNzaWdubWVudHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KG1vZGVsKSB7XG4gICAgYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlRGVzdHJveShtb2RlbClcbiAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJEZXN0cm95KG1vZGVsKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgdG8gc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9IFthY3Rpb25dIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNlcmlhbGl6ZWQgbW9kZWwgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZShtb2RlbCwgYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuc2VyaWFsaXplRnJvbnRlbmRNb2RlbChtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb21tb24gbWV0YWRhdGEgZm9yIG9uZSBuZXN0ZWQtYXR0cmlidXRlcyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIHJlY2VpdmluZyBuZXN0ZWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IGFyZ3MucmF3RW50cmllcyAtIFJhdyBuZXN0ZWQgZW50cmllcyBmcm9tIHRoZSByZXF1ZXN0IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MuY2hpbGRQZXJtaXQgLSBQYXJzZWQgY2hpbGQgcGVybWl0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciBjaGlsZCByZXNvdXJjZSBsb29rdXAuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0eTogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGNoaWxkUmVzb3VyY2U6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UsIGNoaWxkUmVzb3VyY2VDb25maWc6IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiwgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBkZXN0cm95UGVybWl0dGVkOiBib29sZWFuLCBlbnRyaWVzOiBBcnJheTxGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeT4sIHJlbGF0aW9uc2hpcDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0LCB0YXJnZXRNb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBOZXN0ZWQgcmVsYXRpb25zaGlwIGNvbnRleHQuXG4gICAqL1xuICBfbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7cGFyZW50LCByZWxhdGlvbnNoaXBOYW1lLCByYXdFbnRyaWVzLCBjaGlsZFBlcm1pdCwgY29udHJvbGxlcn0pIHtcbiAgICBpZiAoIWNvbnRyb2xsZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9JyByZXF1aXJlIGEgY29udHJvbGxlciBpbnN0YW5jZS5gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcmVudE1vZGVsQ2xhc3MgPSBwYXJlbnQuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgbW9kZWxBY2NlcHRhbmNlID0gcGFyZW50TW9kZWxDbGFzcy5hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghbW9kZWxBY2NlcHRhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfSBkb2VzIG5vdCBhY2NlcHQgbmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9Jy4gRGVjbGFyZSBpdCB2aWEgJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9LmFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKCcke3JlbGF0aW9uc2hpcE5hbWV9JykuYClcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBwYXJlbnRNb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcFR5cGUgPSByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpXG4gICAgY29uc3QgcmF3Tm9ybWFsaXplZEVudHJpZXMgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBFbnRyaWVzKHtyYXdFbnRyaWVzLCByZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBUeXBlfSlcbiAgICBjb25zdCBkZXN0cm95UGVybWl0dGVkID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5pbmNsdWRlcyhcIl9kZXN0cm95XCIpXG5cbiAgICBpZiAoZGVzdHJveVBlcm1pdHRlZCAmJiAhbW9kZWxBY2NlcHRhbmNlLmFsbG93RGVzdHJveSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSBwZXJtaXRzIF9kZXN0cm95IG9uIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgdGhlIG1vZGVsICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfSBkb2VzIG5vdCBhbGxvdyBkZXN0cm95IGZvciB0aGF0IHJlbGF0aW9uc2hpcC4gU2V0IHthbGxvd0Rlc3Ryb3k6IHRydWV9IG9uICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScsIC4uLikuYClcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBtb2RlbEFjY2VwdGFuY2UubGltaXQgPT09IFwibnVtYmVyXCIgJiYgcmF3Tm9ybWFsaXplZEVudHJpZXMubGVuZ3RoID4gbW9kZWxBY2NlcHRhbmNlLmxpbWl0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBleGNlZWRzIG1vZGVsLWRlY2xhcmVkIGxpbWl0IG9mICR7bW9kZWxBY2NlcHRhbmNlLmxpbWl0fS5gKVxuICAgIH1cbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZSAhPT0gXCJoYXNNYW55XCIgJiYgcmF3Tm9ybWFsaXplZEVudHJpZXMubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYWNjZXB0cyBvbmUgZW50cnkgZm9yICR7cmVsYXRpb25zaGlwVHlwZX0gcmVsYXRpb25zaGlwcy5gKVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIHJlc29sdmVkIGZvciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nIG9uICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5gKVxuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkUmVzb3VyY2VDb25maWcgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWNoaWxkUmVzb3VyY2VDb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcmVnaXN0ZXJlZCBmb3IgY2hpbGQgbW9kZWwgJyR7dGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0nIHVuZGVyIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScuYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlID0gbmV3IGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDbGFzcyh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0IHx8IHt9LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBtb2RlbE5hbWU6IGNoaWxkUmVzb3VyY2VDb25maWcubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiX2Rlc3Ryb3lcIilcbiAgICBjb25zdCBlbnRyaWVzID0gcmF3Tm9ybWFsaXplZEVudHJpZXNcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkpXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIG1vZGVsQWNjZXB0YW5jZS5yZWplY3RJZiAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdHJ1ZVxuXG4gICAgICAgIHJldHVybiAhbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmKGlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykgPyBlbnRyeS5hdHRyaWJ1dGVzIDoge30pXG4gICAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdHk6IGNvbnRyb2xsZXIuY3VycmVudEFiaWxpdHkoKSB8fCB0aGlzLmFiaWxpdHksXG4gICAgICBjaGlsZFJlc291cmNlLFxuICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZyxcbiAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgZGVzdHJveVBlcm1pdHRlZCxcbiAgICAgIGVudHJpZXMsXG4gICAgICByZWxhdGlvbnNoaXAsXG4gICAgICB0YXJnZXRNb2RlbENsYXNzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgbmVzdGVkIGVudHJpZXMgZm9yIGNvbGxlY3Rpb24gYW5kIHNpbmd1bGFyIHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIGVudHJpZXMgaW5wdXRzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gYXJncy5yYXdFbnRyaWVzIC0gUmF3IG5lc3RlZCBlbnRyaWVzIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5Pn0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkgb2JqZWN0cy5cbiAgICovXG4gIF9uZXN0ZWRSZWxhdGlvbnNoaXBFbnRyaWVzKHtyYXdFbnRyaWVzLCByZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBUeXBlfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJhd0VudHJpZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXJyYXkgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHJhd0VudHJpZXMgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghaXNQbGFpbk9iamVjdChyYXdFbnRyaWVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgcmV0dXJuIFsvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAocmF3RW50cmllcyldXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmVzdGVkIGVudHJ5IGZyb20gZWl0aGVyIGludGVybmFsIHRyYW5zcG9ydCBzaGFwZVxuICAgKiAoYHthdHRyaWJ1dGVzLCBhdHRhY2htZW50cywgbmVzdGVkQXR0cmlidXRlc31gKSBvciBkaXJlY3QgUmFpbHMtc3R5bGVcbiAgICogZmllbGRzIChge25hbWUsIGZpbGUsIGNvbW1lbnRzQXR0cmlidXRlc31gKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOb3JtYWxpemF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncy5jaGlsZFBlcm1pdCAtIFBhcnNlZCBjaGlsZCBwZXJtaXQgc3BlYy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gYXJncy5lbnRyeSAtIFJhdyBuZXN0ZWQgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeS5cbiAgICovXG4gIF9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGlkIG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLmlkID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IF9kZXN0cm95IG11c3QgYmUgYSBib29sZWFuLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLl9kZXN0cm95ID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0YWNobWVudHNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRhY2htZW50cyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dGFjaG1lbnRzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwibmVzdGVkQXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IG5lc3RlZEF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihuZXN0ZWRBdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbmVzdGVkIGF0dHJpYnV0ZXMga2V5OiAke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgICAgaWYgKCFjaGlsZFBlcm1pdC5uZXN0ZWRbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgdW5kZXIgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBJbmNsdWRlIHske2F0dHJpYnV0ZU5hbWV9OiBbLi4uXX0gaW4gdGhhdCBuZXN0ZWQgcGVybWl0LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1thdHRyaWJ1dGVOYW1lXSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBiZWxvbmdzLXRvIG5lc3RlZCBhdHRyaWJ1dGVzIGJlZm9yZSB0aGUgcGFyZW50IHNhdmUgc28gdGhlIHBhcmVudCBGSyBjYW4gYmUgc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChjb250ZXh0LnJlbGF0aW9uc2hpcCwgcGFyZW50LmdldE1vZGVsQ2xhc3MoKSlcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG5cbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgICAgIHBhcmVudC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgbnVsbClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuICAgICAgICBjb25zdCBjaGlsZCA9IGlkICE9IHVuZGVmaW5lZFxuICAgICAgICAgID8gYXdhaXQgdGhpcy5fZmluZE5lc3RlZFJlY29yZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG4gICAgICAgICAgOiBuZXcgY29udGV4dC50YXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fYXV0aG9yaXplQ3JlYXRlZENoaWxkKHtcbiAgICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG5cbiAgICAgICAgcGFyZW50LnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBjaGlsZC5pZCgpKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgYG5lc3RlZEF0dHJpYnV0ZXNgIHBheWxvYWQgdG8gYSBmcmVzaGx5LXNhdmVkIHBhcmVudCBtb2RlbCxcbiAgICogY2FzY2FkaW5nIGNyZWF0ZS91cGRhdGUvZGVzdHJveSB3cml0ZXMgYWNyb3NzIHRoZSBkZWNsYXJlZCByZWxhdGlvbnNoaXBzLlxuICAgKlxuICAgKiBFYWNoIGNoaWxkIGlzIGF1dGhvcml6ZWQgYWdhaW5zdCBpdHMgb3duIHJlc291cmNlJ3MgYWJpbGl0aWVzIChuZXZlciB0aGVcbiAgICogcGFyZW50J3MpLiBEZXN0cm95cyBydW4gYmVmb3JlIHVwZGF0ZXMsIHVwZGF0ZXMgYmVmb3JlIGNyZWF0ZXMsIHRvIGF2b2lkXG4gICAqIHVuaXF1ZS1jb25zdHJhaW50IGNvbmZsaWN0cyB3aGVuIHJlcGxhY2luZyBhIGNoaWxkIGF0IHRoZSBzYW1lIG5hdHVyYWwga2V5LlxuICAgKlxuICAgKiBBdHRyaWJ1dGUgZmlsdGVyaW5nIGZvciBuZXN0ZWQgY2hpbGRyZW4gdXNlcyB0aGUgcGFyZW50IHJlc291cmNlJ3NcbiAgICogcGVybWl0IHNwZWMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlCBhcGlfbWFrZXItc3R5bGUuIFBvbGljeSBvcHRpb25zXG4gICAqIChhbGxvd0Rlc3Ryb3ksIGxpbWl0LCByZWplY3RJZikgY29tZSBmcm9tIHRoZSBNT0RFTCdzXG4gICAqIGBhY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IobmFtZSlgIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nIGFyZSBub3QgcGVybWl0dGVkIGJ5ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKS4gSW5jbHVkZSB7JHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXM6IFsuLi5dfSBpbiB0aGUgcmV0dXJuZWQgcGVybWl0LmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgcGFyZW50TGlua0F0dHJpYnV0ZXMgPSB0aGlzLl9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByZWxhdGlvbnNoaXA6IGNvbnRleHQucmVsYXRpb25zaGlwLFxuICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlc3Ryb3lFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHVwZGF0ZUVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgY3JlYXRlRW50cmllcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udGV4dC5lbnRyaWVzKSB7XG4gICAgICAgIGlmIChlbnRyeT8uX2Rlc3Ryb3kpIHtcbiAgICAgICAgICBpZiAoIWNvbnRleHQuZGVzdHJveVBlcm1pdHRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgcmVxdWVzdGVkIF9kZXN0cm95IGJ1dCBcIl9kZXN0cm95XCIgaXMgbm90IGluIHRoZSBwZXJtaXQgZm9yIHRoaXMgcmVsYXRpb25zaGlwLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZW50cnkuaWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVzdHJveUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfSBlbHNlIGlmIChlbnRyeT8uaWQpIHtcbiAgICAgICAgICB1cGRhdGVFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3JlYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZGVzdHJveUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLmRlc3Ryb3koZXhpc3RpbmcpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdXBkYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIHVwZGF0ZSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBwYXJlbnQsXG4gICAgICAgICAgcGFyZW50TGlua0F0dHJpYnV0ZXMsXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQ6IGV4aXN0aW5nLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgZXhpc3Rpbmcuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjcmVhdGVFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgY2hpbGQuYXNzaWduKHBhcmVudExpbmtBdHRyaWJ1dGVzKVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgb25lIG5lc3RlZCBlbnRyeSdzIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzIHRvIGEgY2hpbGQgbW9kZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzaWdubWVudCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCByZWNlaXZpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyAtIFBlcm1pdHRlZCBjaGlsZCBhdHRyaWJ1dGUgYW5kIGF0dGFjaG1lbnQgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmVudHJ5IC0gTmVzdGVkIGVudHJ5IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7Y2hpbGQsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLCBlbnRyeX0pIHtcbiAgICBpZiAoZW50cnkuYXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRyaWJ1dGVzIHRvIGJlIGFuIG9iamVjdC5cIilcblxuICAgICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKGNoaWxkLCBjaGlsZC5nZXRNb2RlbENsYXNzKCksIGVudHJ5LmF0dHJpYnV0ZXMsIHRoaXMsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKGNoaWxkLCBmaWx0ZXJlZClcbiAgICB9XG5cbiAgICBpZiAoZW50cnkuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCAmJiAhaXNQbGFpbk9iamVjdChlbnRyeS5hdHRhY2htZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMoY2hpbGQsIGVudHJ5LmF0dGFjaG1lbnRzID8/IG51bGwsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgcmVsYXRpb25zaGlwJ3MgZm9yZWlnbi1rZXkgY29sdW1uL25hbWUgdG8gdGhlIHRhcmdldCBtb2RlbCdzIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGNvbnRhaW5pbmcgdGhlIEZLLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JlaWduLWtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIF9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgIHJldHVybiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtmb3JlaWduS2V5XSB8fCBmb3JlaWduS2V5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgRksgYXR0cmlidXRlcyB0aGF0IGJpbmQgYSBuZXN0ZWQgY2hpbGQgdG8gaXRzIHBhcmVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYXJlbnQtbGluayBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IEF0dHJpYnV0ZXMgdGhhdCBzY29wZSB0aGUgY2hpbGQgdG8gdGhlIHBhcmVudC5cbiAgICovXG4gIF9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtwYXJlbnQsIHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHtbZm9yZWlnbktleV06IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAocGFyZW50LmlkKCkpfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICBjb25zdCB0eXBlQXR0cmlidXRlID0gdGhpcy5fcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBhdHRyaWJ1dGVzW3R5cGVBdHRyaWJ1dGVdID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBwb2x5bW9ycGhpYyB0eXBlIGNvbHVtbi9uYW1lIHRvIGEgY2hpbGQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgdHlwZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBvbHltb3JwaGljIHR5cGUgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpY1R5cGVDb2x1bW4oKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3R5cGVDb2x1bW5dIHx8IHR5cGVDb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBhdXRob3JpemVkIG5lc3RlZCByZWNvcmQgYnkgaWQgd2l0aG91dCBwYXJlbnQgc2NvcGluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQXV0aG9yaXplZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kTmVzdGVkUmVjb3JkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkoe1twcmltYXJ5S2V5XTogaWR9KVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgJHthY3Rpb259IG5lc3RlZCAke3JlbGF0aW9uc2hpcE5hbWV9W2lkPSR7aWR9XTogcmVjb3JkIG5vdCBmb3VuZCBvciBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cblxuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhYmlsaXR5IGFjdGlvbiBmb3IgYSBjaGlsZCByZXNvdXJjZSB1c2luZyB0aGUgY2hpbGQncyBvd25cbiAgICogYGFiaWxpdGllc2AgbWFwcGluZyDigJQgbmV2ZXIgdGhlIHBhcmVudCBjb250cm9sbGVyJ3MuIFRoaXMgcHJlc2VydmVzXG4gICAqIGN1c3RvbSBtYXBwaW5ncyBsaWtlIGB7dXBkYXRlOiBcIm1hbmFnZVwifWAgYW5kIGNhdGNoZXMgdW5tYXBwZWQgYWN0aW9uc1xuICAgKiBpbnN0ZWFkIG9mIHNpbGVudGx5IGRlZmF1bHRpbmcgdG8gdGhlIHJhdyBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFiaWxpdHkgYWN0aW9uIGZvciB0aGUgY2hpbGQgcmVzb3VyY2UuXG4gICAqL1xuICBfcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24/LmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFuICdhYmlsaXRpZXMnIG9iamVjdCB0byBhdXRob3JpemUgbmVzdGVkICR7YWN0aW9ufS5gKVxuICAgIH1cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFiaWxpdGllcy4ke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICByZXR1cm4gYWJpbGl0eUFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFuIGV4aXN0aW5nIGNoaWxkIGZvciBhIG5lc3RlZCB1cGRhdGUvZGVzdHJveSwgc2NvcGVkIHRvIHRoZVxuICAgKiBjaGlsZCdzIG93biBtb2RlbCBjbGFzcywgdGhlIHBhcmVudCdzIGZvcmVpZ24ga2V5LCBBTkQgdGhlIGNoaWxkXG4gICAqIHJlc291cmNlJ3MgYWJpbGl0eSBtYXBwaW5nIGZvciB0aGUgcmVxdWVzdGVkIGFjdGlvbi4gVGhyb3dzIHdoZW4gdGhlXG4gICAqIGNoaWxkIGRvZXMgbm90IGV4aXN0LCBkb2VzIG5vdCBiZWxvbmcgdG8gdGhlIGN1cnJlbnQgcGFyZW50LCBvciBpc1xuICAgKiBub3QgYXV0aG9yaXplZCDigJQgYWxsIG9mIHdoaWNoIG11c3Qgcm9sbCB0aGUgdHJhbnNhY3Rpb24gYmFjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gYXJncy5pZCAtIENoaWxkIGlkIGZyb20gdGhlIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGFyZ3MucGFyZW50TGlua0F0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCwgcGFyZW50LWxpbmtlZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kU2NvcGVkQ2hpbGQoe2FiaWxpdHksIGFjdGlvbiwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGlkLCBwYXJlbnQsIHBhcmVudExpbmtBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGxvb2t1cCA9IHtbcHJpbWFyeUtleV06IGlkLCAuLi5wYXJlbnRMaW5rQXR0cmlidXRlc31cbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShsb29rdXApXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kLCBkb2VzIG5vdCBiZWxvbmcgdG8gcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0sIG9yIGlzIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgYW4gYWxyZWFkeS1zYXZlZCBuZXN0ZWQgY2hpbGQgaXMgYXV0aG9yaXplZCB1bmRlciB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBvd24gYGNyZWF0ZWAgYWJpbGl0eS4gUm9sbHMgYmFjayB2aWEgdGhyb3duIGVycm9yIHdoZW4gbm90XG4gICAqIGF1dGhvcml6ZWQgc28gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGRlc3Ryb3lzIHRoZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCBpbnN0YW5jZSBqdXN0IGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe2FiaWxpdHksIGNoaWxkLCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIWFiaWxpdHkpIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRhcmdldE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgYXV0aG9yaXplZElkcyA9IGF3YWl0IHRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIC5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24sIGFiaWxpdHkpXG4gICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogY2hpbGQucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5KX0pXG4gICAgICAucGx1Y2socHJpbWFyeUtleSlcblxuICAgIGlmIChhdXRob3JpemVkSWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgY3JlYXRlIG9uICR7cmVsYXRpb25zaGlwTmFtZX1bJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9XSBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBuZXN0ZWQgd3JpdGVzLCBwcmVsb2FkIGV2ZXJ5IHJlbGF0aW9uc2hpcCBkZWNsYXJlZCBpbiB0aGVcbiAgICogcGFyZW50J3MgcGVybWl0IHNvIHRoZSBwb3N0LXNhdmUgc2VyaWFsaXplIHN0ZXAgZW1pdHMgdGhlbSBhbmQgdGhlXG4gICAqIGNsaWVudCBjYW4gcmVjb25jaWxlIGlkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBTYXZlZCBwYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IHBlcm1pdCAtIFBhcnNlZCBwYXJlbnQgcGVybWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lcyA9IE9iamVjdC5rZXlzKHBlcm1pdC5uZXN0ZWQpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZWxhdGlvbnNoaXBOYW1lcykge1xuICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFBhcnNlcyB0aGUgUmFpbHMvYXBpX21ha2VyLXN0eWxlIGZsYXQgcGVybWl0IHNwZWMgcmV0dXJuZWQgZnJvbVxuICogYHBlcm1pdHRlZFBhcmFtcyhhcmcpYCBpbnRvIGEgc3RydWN0dXJlZCBzaGFwZSB1c2VkIGludGVybmFsbHkgYnkgdGhlXG4gKiB3cml0ZSBwaXBlbGluZS4gU3RyaW5ncyBiZWNvbWUgYXR0cmlidXRlIHBlcm1pdHM7IG9iamVjdHMgd2hvc2Uga2V5c1xuICogZW5kIGluIGBBdHRyaWJ1dGVzYCBiZWNvbWUgbmVzdGVkIHBlcm1pdHMgKHRoZSBrZXkgcHJlZml4IG5hbWVzIHRoZVxuICogcmVsYXRpb25zaGlwKS5cbiAqXG4gKiAgIHBhcnNlUGVybWl0dGVkUGFyYW1zKFtcImZpcnN0TmFtZVwiLCBcImxhc3ROYW1lXCIsXG4gKiAgICAge3Rhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gKiAgIF0pXG4gKiAgIC8vIOKGkiB7XG4gKiAgIC8vICAgYXR0cmlidXRlczogW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIl0sXG4gKiAgIC8vICAgbmVzdGVkOiB7XG4gKiAgIC8vICAgICB0YXNrczoge2F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdLCBuZXN0ZWQ6IHt9fVxuICogICAvLyAgIH1cbiAqICAgLy8gfVxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+IHwgdW5kZWZpbmVkfSBwZXJtaXRTcGVjIC0gRmxhdCBwZXJtaXQgc3BlYy5cbiAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fX0gLSBQYXJzZWQgc3RydWN0dXJlLlxuICovXG5mdW5jdGlvbiBwYXJzZVBlcm1pdHRlZFBhcmFtcyhwZXJtaXRTcGVjKSB7XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgY29uc3QgbmVzdGVkID0ge31cblxuICBpZiAoIUFycmF5LmlzQXJyYXkocGVybWl0U3BlYykpIHJldHVybiB7YXR0cmlidXRlcywgbmVzdGVkfVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgcGVybWl0U3BlYykge1xuICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGF0dHJpYnV0ZXMucHVzaChlbnRyeSlcbiAgICB9IGVsc2UgaWYgKGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBuZXN0ZWQgcmVsYXRpb25zaGlwIGtleXMgbXVzdCBlbmQgaW4gXCJBdHRyaWJ1dGVzXCIgKGdvdCBcIiR7a2V5fVwiKS4gVXNlIFwiJHtrZXl9QXR0cmlidXRlc1wiIGluc3RlYWQuYClcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0ga2V5LnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogZW1wdHkgcmVsYXRpb25zaGlwIG5hbWUgaW4ga2V5IFwiJHtrZXl9XCIuYClcbiAgICAgICAgfVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeSBmb3IgXCIke2tleX1cIjogZXhwZWN0ZWQgYXJyYXkgcGVybWl0IHNwZWMsIGdvdCAke3R5cGVvZiB2YWx1ZX0uYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXSA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHZhbHVlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBleHBlY3RlZCBzdHJpbmcgb3IgbmVzdGVkLWF0dHJpYnV0ZXMgb2JqZWN0LCBnb3QgJHt0eXBlb2YgZW50cnl9LmApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG59XG5cbi8qKlxuICogTG9jYXRlcyB3aGljaCBwcm90b3R5cGUgb3ducyBhIG1ldGhvZCBpbXBsZW1lbnRhdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBpbnN0YW5jZSAtIEluc3RhbmNlIHJlY2VpdmluZyB0aGUgbWV0aG9kLlxuICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAqIEByZXR1cm5zIHtvYmplY3QgfCBudWxsfSAtIFByb3RvdHlwZSB0aGF0IG93bnMgdGhlIG1ldGhvZC5cbiAqL1xuZnVuY3Rpb24gcHJvdG90eXBlT3duZXJGb3JNZXRob2QoaW5zdGFuY2UsIG1ldGhvZE5hbWUpIHtcbiAgbGV0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihpbnN0YW5jZSlcblxuICB3aGlsZSAocHJvdG90eXBlKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwcm90b3R5cGUsIG1ldGhvZE5hbWUpKSByZXR1cm4gcHJvdG90eXBlXG5cbiAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZpbHRlciB3cml0YWJsZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHRlbXBsYXRlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzfSBSZXNvdXJjZU1vZGVsQ2xhc3NcbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzc1xuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlY2VpdmVyIC0gTW9kZWwgaW5zdGFuY2Ugb3IgcHJvdG90eXBlLlxuICogQHBhcmFtIHtXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3N9IHJlY2VpdmVyQ2xhc3MgLSBTdGF0aWMgaGVscGVyIG93bmVyIGZvciB0aGUgcmVjZWl2ZXIuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2U8UmVzb3VyY2VNb2RlbENsYXNzLCBSZXNvdXJjZURhdGFiYXNlTW9kZWxDbGFzcz4gfCBudWxsfSBbcmVzb3VyY2VdIC0gUmVzb3VyY2UgaW5zdGFuY2UgZm9yIHZpcnR1YWwtc2V0dGVyIGRldGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCBudWxsfSBbcGVybWl0dGVkQXR0cmlidXRlTmFtZXNdIC0gT3B0aW9uYWwgZXhwbGljaXQgcGVybWl0IGxpc3QuIGBudWxsYCBmYWxscyBiYWNrIHRvIHNldHRlci1leGlzdGVuY2UgY2hlY2tzIG9ubHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdyaXRhYmxlIGF0dHJpYnV0ZXMgb25seS5cbiAqL1xuZnVuY3Rpb24gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhcbiAgcmVjZWl2ZXIsXG4gIHJlY2VpdmVyQ2xhc3MsXG4gIGF0dHJpYnV0ZXMsXG4gIHJlc291cmNlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlPFJlc291cmNlTW9kZWxDbGFzcywgUmVzb3VyY2VEYXRhYmFzZU1vZGVsQ2xhc3M+IHwgbnVsbH0gKi8gKG51bGwpLFxuICBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyA9IG51bGxcbikge1xuICAvLyBGcm9udGVuZC1tb2RlbCB3cml0ZXMgc2hvdWxkIGZhaWwgZmFzdCB3aGVuIGNhbGxlcnMgc3VibWl0IHJlYWQtb25seSBvciB1bmtub3duIGF0dHJzLlxuICAvLyBTaWxlbnQgZHJvcHMgaGlkZSBjb250cmFjdCBtaXN0YWtlcyBpbiBnZW5lcmF0ZWQgbW9kZWxzIGFuZCBhcHAtc2lkZSB3cmFwcGVyIGNvZGUuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCB3cml0YWJsZUF0dHJpYnV0ZXMgPSB7fVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMgPSBbXVxuXG4gIGNvbnN0IHBlcm1pdFNldCA9IEFycmF5LmlzQXJyYXkocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpID8gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgOiBudWxsXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGxldCB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgaWYgKHJlc291cmNlKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcblxuICAgIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdXG4gIH1cblxuICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldCh0cmFuc2xhdGVkQXR0cmlidXRlcylcblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAocGVybWl0U2V0ICYmICFwZXJtaXRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gcmVjZWl2ZXJDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB8fCBhdHRyaWJ1dGVOYW1lXG4gICAgY29uc3QgcmVxdWVzdGVkU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHJlY2VpdmVyQ2xhc3MuZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZShyZWNlaXZlciwgcmVxdWVzdGVkU2V0dGVyTmFtZSkgfHwgcmVxdWVzdGVkU2V0dGVyTmFtZVxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9QXR0cmlidXRlYFxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gcmVzb3VyY2U/LnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgIGlmIChzZXR0ZXJOYW1lIGluIHJlY2VpdmVyKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2Uge1xuICAgICAgaW52YWxpZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIGlmIChub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBGcm9udGVuZCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzIG5vdCBwZXJtaXR0ZWQgYnkgcGVybWl0dGVkUGFyYW1zKCk6ICR7bm90UGVybWl0dGVkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgfVxuXG4gIHJldHVybiB3cml0YWJsZUF0dHJpYnV0ZXNcbn1cbiJdfQ==