// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import * as inflection from "inflection";
import isPlainObject from "../utils/plain-object.js";
import VelociousError from "../velocious-error.js";
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
 *   frontendModelIndexQuery: (options?: FrontendModelResourceIndexQueryOptions & {resource?: FrontendModelBaseResource}) => import("../database/query/model-class-query.js").default<typeof import("../database/record/index.js").default>,
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
 * @typedef {object} FrontendModelResourceAbilityArgs
 * @property {import("../authorization/ability.js").default} [ability] - Ability instance when the resource is used directly for authorization.
 * @property {import("../configuration.js").default} [configuration] - Velocious configuration for controller-less construction (for example the sync websocket channel); the controller path derives it from the controller instead.
 * @property {import("../configuration-types.js").VelociousLooseObject} [context] - Ability context.
 * @property {import("../configuration-types.js").VelociousLooseObject} [locals] - Ability locals.
 * @property {typeof import("../database/record/index.js").default} [modelClass] - Optional backing model class override.
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
 * @template {typeof import("../database/record/index.js").default} [TModelClass=typeof import("../database/record/index.js").default]
 */
export default class FrontendModelBaseResource extends AuthorizationBaseResource {
    /** @type {typeof import("../database/record/index.js").default | undefined} */
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
     * @param {FrontendModelResourceAbilityArgs | FrontendModelResourceControllerArgs} args - Resource args.
     */
    constructor(args) {
        super({
            ability: "ability" in args ? args.ability : undefined,
            context: "context" in args ? args.context || {} : {},
            locals: "locals" in args ? args.locals || {} : {}
        });
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        const defaultResourceConfiguration = /** @type {import("../configuration-types.js").FrontendModelResourceConfiguration} */ ({ attributes: [] });
        this.controller = "controller" in args ? args.controller : undefined;
        this.configurationValue = "configuration" in args ? args.configuration : undefined;
        this.modelClassValue = "modelClass" in args ? args.modelClass : ResourceClass.modelClass();
        this.modelNameValue = "modelName" in args ? args.modelName : this.modelClass().getModelName();
        this.paramsValue = "params" in args ? args.params : undefined;
        this.resourceConfigurationValue = "resourceConfiguration" in args ? args.resourceConfiguration : defaultResourceConfiguration;
        /** @type {FrontendModelBaseResource | null | undefined} */
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
     * @returns {FrontendModelBaseResource | null} - Shared resource instance when configured.
     */
    sharedResourceInstance() {
        if (this.sharedResourceInstanceValue !== undefined)
            return this.sharedResourceInstanceValue;
        const ResourceClass = /** @type {typeof FrontendModelBaseResource} */ (this.constructor);
        const SharedResource = /** @type {typeof FrontendModelBaseResource | undefined} */ (ResourceClass.sharedResourceClass());
        if (!SharedResource) {
            this.sharedResourceInstanceValue = null;
            return this.sharedResourceInstanceValue;
        }
        if (SharedResource === ResourceClass) {
            throw new Error(`${ResourceClass.name}.SharedResource cannot point to itself.`);
        }
        this.sharedResourceInstanceValue = new SharedResource({
            ability: this.ability,
            controller: this.controller,
            context: this.context,
            locals: this.locals,
            modelClass: this.modelClass(),
            modelName: this.modelName(),
            params: this.params(),
            resourceConfiguration: this.resourceConfiguration()
        });
        return this.sharedResourceInstanceValue;
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
     * @returns {{method: (...methodArgs: unknown[]) => unknown, resource: FrontendModelBaseResource} | null} - Resolved method and receiver.
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
     * Runs static model class.
     * @returns {typeof import("../database/record/index.js").default} - Backing model class.
     */
    static modelClass() {
        if (!this.ModelClass)
            throw new Error(`${this.name} requires a static ModelClass.`);
        return this.ModelClass;
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
        return /** @type {TModelClass} */ (this.modelClassValue);
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
        const ModelClass = this.modelClass();
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
     * @returns {import("../database/query/model-class-query.js").default<TModelClass>} - Authorized query.
     */
    authorizedQuery(action) {
        // Narrows the controller query to this resource's model class.
        return /** @type {import("../database/query/model-class-query.js").default<TModelClass>} */ (this.typedControllerInstance().frontendModelAbilityAuthorizedQuery(action));
    }
    /**
     * Runs index query.
     * @param {FrontendModelResourceIndexQueryOptions} [options] - Query options.
     * @returns {import("../database/query/model-class-query.js").default<TModelClass>} - Frontend-model index query.
     */
    indexQuery(options = {}) {
        return /** @type {import("../database/query/model-class-query.js").default<TModelClass>} */ (this.typedControllerInstance().frontendModelIndexQuery({
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
        const ModelClass = this.modelClass();
        const filtered = filterWritableFrontendModelAttributes(this.modelClass().prototype, ModelClass, attachmentSplit.attributes, this, permit.attributes);
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
        await this.modelClass().transaction(async () => {
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
        const attachmentDefinitions = this.modelClass().getAttachmentsMap();
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
 * @param {Record<string, ReturnType<typeof JSON.parse>>} receiver - Model instance or prototype.
 * @param {WritableAttributeReceiverClass} receiverClass - Static helper owner for the receiver.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Incoming frontend-model attributes.
 * @param {FrontendModelBaseResource | null} [resource] - Resource instance for virtual-setter detection.
 * @param {string[] | null} [permittedAttributeNames] - Optional explicit permit list. `null` falls back to setter-existence checks only.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Writable attributes only.
 */
function filterWritableFrontendModelAttributes(receiver, receiverClass, attributes, resource = /** @type {FrontendModelBaseResource | null} */ (null), permittedAttributeNames = null) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7OztHQUdHO0FBRUg7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBMEIsU0FBUSx5QkFBeUI7SUFDOUUsK0VBQStFO0lBQy9FLE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRTdCLG1GQUFtRjtJQUNuRixNQUFNLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtJQUM3QixtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsbUhBQW1IO0lBQ25ILE1BQU0sQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFBO0lBQzlCLG1DQUFtQztJQUNuQyxNQUFNLENBQUMsUUFBUSxHQUFHLFNBQVMsQ0FBQTtJQUMzQixt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QUE7UUFDOUUsTUFBTSxjQUFjLEdBQUcsUUFBUSxFQUFFLGNBQWMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRW5FLElBQUksVUFBVSxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQzNCLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMzQyxDQUFDO2FBQU0sSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUMxQixrQkFBa0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUE7UUFDM0MsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQzVDLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMzQyxDQUFDO2FBQU0sQ0FBQztZQUNOLGlCQUFpQixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUN2QyxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3RDLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyx1RUFBdUUsc0JBQXNCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO0lBQ2pMLENBQUM7SUFFRCxJQUFJLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsNENBQTRDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtJQUNqSixDQUFDO0lBRUQsT0FBTyxrQkFBa0IsQ0FBQTtBQUMzQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBCdWlsdC1pbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBhY3Rpb24uXG4gKiBAdHlwZWRlZiB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvblxuICovXG5cbi8qKlxuICogRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBtZXRob2RzIHVzZWQgYnkgcmVzb3VyY2VzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdCAmIHtcbiAqICAgY3VycmVudEFiaWxpdHk6ICgpID0+IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uOiAoYXJnczoge3BhZ2luYXRpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24sIHF1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTZWFyY2g6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc2VhcmNoOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTb3J0OiAoYXJnczoge3F1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sIHNvcnQ6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9KSA9PiB2b2lkLFxuICogICBmcm9udGVuZE1vZGVsQWJpbGl0eUFjdGlvbjogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBzdHJpbmcsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeTogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5OiAob3B0aW9ucz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zICYge3Jlc291cmNlPzogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbFBhcmFtczogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMsXG4gKiAgIGZyb250ZW5kTW9kZWxQcmVsb2FkOiAoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbCxcbiAqICAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3M6IChtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGwsXG4gKiAgIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWw6IChtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgb2JqZWN0IHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+PlxuICogfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlclxuICovXG5cbi8qKlxuICogR2VuZXJpYyBmcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeSBwYXNzZWQgdG8gcmVzb3VyY2UgcXVlcnkgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBpbmRleCBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3NcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gY29udHJvbGxlciAtIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gKG9yIHJhdyBpbnB1dCBzaGFwZSBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnc1xuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZSB3aGVuIHRoZSByZXNvdXJjZSBpcyB1c2VkIGRpcmVjdGx5IGZvciBhdXRob3JpemF0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyLWxlc3MgY29uc3RydWN0aW9uIChmb3IgZXhhbXBsZSB0aGUgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCk7IHRoZSBjb250cm9sbGVyIHBhdGggZGVyaXZlcyBpdCBmcm9tIHRoZSBjb250cm9sbGVyIGluc3RlYWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtjb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2xvY2Fsc10gLSBBYmlsaXR5IGxvY2Fscy5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbbW9kZWxDbGFzc10gLSBPcHRpb25hbCBiYWNraW5nIG1vZGVsIGNsYXNzIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFttb2RlbE5hbWVdIC0gT3B0aW9uYWwgbW9kZWwgbmFtZSBvdmVycmlkZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBbcmVzb3VyY2VDb25maWd1cmF0aW9uXSAtIE9wdGlvbmFsIG5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZWQgc3luYyByZXBsYXkgbXV0YXRpb24gcGFzc2VkIHRvIHRoZSByZXNvdXJjZSBzeW5jIGhvb2tzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL3N5bmMvc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IEZyb250ZW5kTW9kZWxTeW5jTXV0YXRpb25cbiAqL1xuXG4vKipcbiAqIFN5bmMgbXV0YXRpb24gYXV0aG9yaXphdGlvbiByZXN1bHQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb25cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gYWxsb3dlZCAtIFdoZXRoZXIgdGhlIG11dGF0aW9uIG1heSBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtyZWFzb25dIC0gU3RhYmxlIGZhaWx1cmUgcmVhc29uIGNvZGUgd2hlbiBkZW5pZWQuXG4gKi9cblxuLyoqXG4gKiBBcmd1bWVudHMgZm9yIHRoZSBhcHBseVN5bmMgZnVsbC1lc2NhcGUtaGF0Y2ggaG9vay5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxBcHBseVN5bmNBcmdzXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGV4aXN0aW5nU3luYyAtIEV4aXN0aW5nIHN5bmMgcm93IG9yIG51bGwuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IG11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gKi9cblxuLyoqXG4gKiBBcHBseSByZXN1bHQgcHJvZHVjZWQgYnkgcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNyZWF0ZWQgLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGVsZXRlZF0gLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBkZWxldGVkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IHJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gKi9cblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IG93bmluZyB0aGUgcmVzb3VyY2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogVHJhbnNwb3J0LXNhZmUgdmFsdWUgYWNjZXB0ZWQgaW4gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb24gcGF5bG9hZHMuXG4gKiBOZXN0ZWQgb2JqZWN0L2FycmF5IHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHNcbiAqIHJlY3Vyc2l2ZSBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgcGF5bG9hZCBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZVxuICovXG5cbi8qKlxuICogQXR0cmlidXRlIHBheWxvYWQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZT59IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWRcbiAqL1xuXG4vKipcbiAqIFZpcnR1YWwgc2V0dGVyIG1ldGhvZCBvbiBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlLlxuICogQHR5cGVkZWYgeyhhcmcxOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgYXJnMjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlKSA9PiAodm9pZCB8IFByb21pc2U8dm9pZD4pfSBGcm9udGVuZE1vZGVsUmVzb3VyY2VWaXJ0dWFsU2V0dGVyXG4gKi9cblxuLyoqXG4gKiBTdGF0aWMgaGVscGVycyB1c2VkIHdoZW4gY2hlY2tpbmcgd2hldGhlciBhIG1vZGVsLWxpa2UgcmVjZWl2ZXIgYWNjZXB0cyBhbiBhdHRyaWJ1dGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3NcbiAqIEBwcm9wZXJ0eSB7KGFyZzogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSByZXNvbHZlQXR0cmlidXRlTmFtZSAtIFJlc29sdmVzIGFsaWFzZXMgdG8gY2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZzE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXJnMjogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSBmaW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlIC0gTG9jYXRlcyBhIHNldHRlciBtZXRob2Qgb24gdGhlIHJlY2VpdmVyLlxuICovXG5cbi8qKlxuICogT3B0aW9ucyBwYXNzZWQgd2hpbGUgc2F2aW5nIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIG11dGF0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbYXR0YWNobWVudHNdIC0gVXBsb2FkZWQgYXR0YWNobWVudCBhdHRyaWJ1dGVzLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbH0gW2NvbnRyb2xsZXJdIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgbXV0YXRpb24uXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbbmVzdGVkQXR0cmlidXRlc10gLSBOZXN0ZWQgYXR0cmlidXRlcyBwYXlsb2FkLlxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkICYge2lkPzogc3RyaW5nIHwgbnVtYmVyLCBfZGVzdHJveT86IGJvb2xlYW4sIGF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBhdHRhY2htZW50cz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQsIG5lc3RlZEF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnlcbiAqL1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tlbmQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtUTW9kZWxDbGFzcz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZXh0ZW5kcyBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHtcbiAgLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBNb2RlbENsYXNzID0gdW5kZWZpbmVkXG5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGFiaWxpdGllcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGF0dGFjaG1lbnRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBjb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29sbGVjdGlvbkNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHNlcnZlciA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luYyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgc3RhdGljIFNoYXJlZFJlc291cmNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlY2xhcmF0aXZlIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCAoY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lcylcbiAgICogdXNlZCBhcyB0aGUgZGVmYXVsdCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNwZXJtaXR0ZWRQYXJhbXN9IGFuZFxuICAgKiBhcyB0aGUgcm91dGVkIHN5bmMgcmVwbGF5IHBlcm1pdC4gUmVzb2x2ZWQgdGhyb3VnaCB0aGUgc2hhcmVkIHJlc291cmNlXG4gICAqIGxpa2UgdGhlIG90aGVyIHN0YXRpYyByZXNvdXJjZSBjb25maWc6IGFuIHVuZGVjbGFyZWQgZW52aXJvbm1lbnQgbGlzdFxuICAgKiBmYWxscyBiYWNrIHRvIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LCB3aGlsZSBhbiBleHBsaWNpdCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucy5cbiAgICogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHdyaXRhYmxlQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHwgRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3N9IGFyZ3MgLSBSZXNvdXJjZSBhcmdzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIHN1cGVyKHtcbiAgICAgIGFiaWxpdHk6IFwiYWJpbGl0eVwiIGluIGFyZ3MgPyBhcmdzLmFiaWxpdHkgOiB1bmRlZmluZWQsXG4gICAgICBjb250ZXh0OiBcImNvbnRleHRcIiBpbiBhcmdzID8gYXJncy5jb250ZXh0IHx8IHt9IDoge30sXG4gICAgICBsb2NhbHM6IFwibG9jYWxzXCIgaW4gYXJncyA/IGFyZ3MubG9jYWxzIHx8IHt9IDoge31cbiAgICB9KVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBcImNvbnRyb2xsZXJcIiBpbiBhcmdzID8gYXJncy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgdGhpcy5jb25maWd1cmF0aW9uVmFsdWUgPSBcImNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5jb25maWd1cmF0aW9uIDogdW5kZWZpbmVkXG4gICAgdGhpcy5tb2RlbENsYXNzVmFsdWUgPSBcIm1vZGVsQ2xhc3NcIiBpbiBhcmdzID8gYXJncy5tb2RlbENsYXNzIDogUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICB0aGlzLm1vZGVsTmFtZVZhbHVlID0gXCJtb2RlbE5hbWVcIiBpbiBhcmdzID8gYXJncy5tb2RlbE5hbWUgOiB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIHRoaXMucGFyYW1zVmFsdWUgPSBcInBhcmFtc1wiIGluIGFyZ3MgPyBhcmdzLnBhcmFtcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUgPSBcInJlc291cmNlQ29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLnJlc291cmNlQ29uZmlndXJhdGlvbiA6IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29uZmlndXJlZCBzaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgc2hhcmVkUmVzb3VyY2VDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5TaGFyZWRSZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgc3RhdGljIHJlc291cmNlIGNvbmZpZyB2YWx1ZSBmcm9tIHRoZSBlbnZpcm9ubWVudCByZXNvdXJjZSBmaXJzdCxcbiAgICogdGhlbiBmcm9tIHRoZSBzaGFyZWQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7XCJhYmlsaXRpZXNcIiB8IFwiYXR0YWNobWVudHNcIiB8IFwiYXR0cmlidXRlc1wiIHwgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIgfCBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiIHwgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiY29tbWFuZHNcIiB8IFwibWVtYmVyQ29tbWFuZHNcIiB8IFwibW9kZWxOYW1lXCIgfCBcInByaW1hcnlLZXlcIiB8IFwicmVsYXRpb25zaGlwc1wiIHwgXCJzZXJ2ZXJcIiB8IFwic3luY1wiIHwgXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiIHwgXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIn0gbmFtZSAtIFN0YXRpYyBjb25maWcgcHJvcGVydHkgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJlc29sdmVkIGNvbmZpZyB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKG5hbWUpIHtcbiAgICBpZiAodGhpc1tuYW1lXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpc1tuYW1lXVxuXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgaWYgKFNoYXJlZFJlc291cmNlW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiBTaGFyZWRSZXNvdXJjZVtuYW1lXVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRyYW5zbGF0ZWQgYXR0cmlidXRlcyBmcm9tIGVudmlyb25tZW50IGFuZCBzaGFyZWQgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9IC0gVHJhbnNsYXRlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBmcm9udGVuZC1zYWZlIGF0dGFjaG1lbnQgZGVjbGFyYXRpb25zIGZyb20gdGhlIGJhY2tpbmcgbW9kZWwuXG4gICAqIFJlc291cmNlLWxldmVsIGRlY2xhcmF0aW9ucyByZW1haW4gYXMgYSBmYWxsYmFjayBmb3IgZnJvbnRlbmQtb25seSByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQ2xpZW50IGF0dGFjaG1lbnQgY29uZmlndXJhdGlvbiBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnRDb25maWd1cmF0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkQXR0YWNobWVudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPiB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImF0dGFjaG1lbnRzXCIpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gY29uZmlndXJlZEF0dGFjaG1lbnRzID8gey4uLmNvbmZpZ3VyZWRBdHRhY2htZW50c30gOiB7fVxuXG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHJldHVybiBhdHRhY2htZW50c1xuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIGRlZmluaXRpb25dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuTW9kZWxDbGFzcy5hdHRhY2htZW50RGVmaW5pdGlvbnMoKSkpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRDb25maWcgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9ufSAqLyAoe3R5cGU6IGRlZmluaXRpb24udHlwZX0pXG5cbiAgICAgIGlmIChkZWZpbml0aW9uLnN5bmMpIGF0dGFjaG1lbnRDb25maWcuc3luYyA9IHsuLi5kZWZpbml0aW9uLnN5bmN9XG5cbiAgICAgIGF0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IGF0dGFjaG1lbnRDb25maWdcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0YWNobWVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByZXNvdXJjZSBpbnN0YW5jZSBmb3Igc2hhcmVkLXJlc291cmNlIGZhbGxiYWNrIGNhbGxzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IG51bGx9IC0gU2hhcmVkIHJlc291cmNlIGluc3RhbmNlIHdoZW4gY29uZmlndXJlZC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlSW5zdGFuY2UoKSB7XG4gICAgaWYgKHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VDbGFzcygpKVxuXG4gICAgaWYgKCFTaGFyZWRSZXNvdXJjZSkge1xuICAgICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSBudWxsXG4gICAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWVcbiAgICB9XG5cbiAgICBpZiAoU2hhcmVkUmVzb3VyY2UgPT09IFJlc291cmNlQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtSZXNvdXJjZUNsYXNzLm5hbWV9LlNoYXJlZFJlc291cmNlIGNhbm5vdCBwb2ludCB0byBpdHNlbGYuYClcbiAgICB9XG5cbiAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IG5ldyBTaGFyZWRSZXNvdXJjZSh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyOiB0aGlzLmNvbnRyb2xsZXIsXG4gICAgICBjb250ZXh0OiB0aGlzLmNvbnRleHQsXG4gICAgICBsb2NhbHM6IHRoaXMubG9jYWxzLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IHRoaXMubW9kZWxOYW1lKCksXG4gICAgICBwYXJhbXM6IHRoaXMucGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2FsbHMgYSBzaGFyZWQtcmVzb3VyY2UgbWV0aG9kIG9ubHkgd2hlbiB0aGUgc2hhcmVkIHJlc291cmNlIG92ZXJyaWRlcyB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHBhcmFtIHt1bmtub3duW119IGFyZ3MgLSBNZXRob2QgYXJncy5cbiAgICogQHJldHVybnMge3tjYWxsZWQ6IGJvb2xlYW4sIHJlc3VsdDogdW5rbm93bn19IC0gU2hhcmVkIG1ldGhvZCBjYWxsIHJlc3VsdC5cbiAgICovXG4gIGNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKSB7XG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cblxuICAgIGNvbnN0IG1ldGhvZE93bmVyID0gcHJvdG90eXBlT3duZXJGb3JNZXRob2Qoc2hhcmVkUmVzb3VyY2UsIG1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIW1ldGhvZE93bmVyIHx8IG1ldGhvZE93bmVyID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZSB8fCBtZXRob2RPd25lciA9PT0gQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZS5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybiB7Y2FsbGVkOiBmYWxzZSwgcmVzdWx0OiB1bmRlZmluZWR9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIHJldHVybiB7Y2FsbGVkOiB0cnVlLCByZXN1bHQ6IG1ldGhvZC5hcHBseShzaGFyZWRSZXNvdXJjZSwgYXJncyl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaGFyZWQgbWV0aG9kIHJlc3VsdCBvciBhIGZhbGxiYWNrIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gU2hhcmVkIG1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIFNoYXJlZCBtZXRob2QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBSZXN1bHR9IGZhbGxiYWNrIC0gRmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtSZXN1bHR9IC0gU2hhcmVkIG9yIGZhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlTWV0aG9kT3IobWV0aG9kTmFtZSwgYXJncywgZmFsbGJhY2spIHtcbiAgICBjb25zdCBzaGFyZWRSZXN1bHQgPSB0aGlzLmNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKVxuXG4gICAgaWYgKHNoYXJlZFJlc3VsdC5jYWxsZWQpIHJldHVybiAvKiogQHR5cGUge1Jlc3VsdH0gKi8gKHNoYXJlZFJlc3VsdC5yZXN1bHQpXG5cbiAgICByZXR1cm4gZmFsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgbWV0aG9kIG9uIHRoaXMgcmVzb3VyY2Ugb3IgaXRzIHNoYXJlZCBmYWxsYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ttZXRob2Q6ICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24sIHJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSB8IG51bGx9IC0gUmVzb2x2ZWQgbWV0aG9kIGFuZCByZWNlaXZlci5cbiAgICovXG4gIHJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUpIHtcbiAgICBjb25zdCBvd25NZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIG93bk1ldGhvZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBtZXRob2Q6IC8qKiBAdHlwZSB7KC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bn0gKi8gKG93bk1ldGhvZCksXG4gICAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNoYXJlZE1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzaGFyZWRSZXNvdXJjZSkpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIHNoYXJlZE1ldGhvZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAoc2hhcmVkTWV0aG9kKSxcbiAgICAgIHJlc291cmNlOiBzaGFyZWRSZXNvdXJjZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFiaWxpdGllcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWJpbGl0aWVzKCkge1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFiaWxpdGllc1wiLCBbXSwgKCkgPT4gdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHlwZWQgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IC0gQ29udHJvbGxlciBpbnN0YW5jZSB3aXRoIGZyb250ZW5kLW1vZGVsIGhlbHBlcnMuXG4gICAqL1xuICB0eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAqLyAodGhpcy5jb250cm9sbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIFN0YXRpYyByZXNvdXJjZSBjb25maWcgKHJhdyB1c2VyIGlucHV0IHNoYXBlOyBjb25zdW1lcnMgbm9ybWFsaXplKS5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0cmlidXRlc1wiKVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImFiaWxpdGllc1wiKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gdGhpcy5hdHRhY2htZW50Q29uZmlndXJhdGlvbnMoKVxuICAgIGNvbnN0IGNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiY29tbWFuZHNcIilcbiAgICBjb25zdCBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kc1wiKVxuICAgIGNvbnN0IGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiKVxuICAgIGNvbnN0IGNvbGxlY3Rpb25Db21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImNvbGxlY3Rpb25Db21tYW5kc1wiKVxuICAgIGNvbnN0IG1lbWJlckNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibWVtYmVyQ29tbWFuZHNcIilcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtb2RlbE5hbWVcIilcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwicHJpbWFyeUtleVwiKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJyZWxhdGlvbnNoaXBzXCIpXG4gICAgY29uc3Qgc2VydmVyID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwic2VydmVyXCIpXG4gICAgY29uc3Qgc3luYyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInN5bmNcIilcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi9cbiAgICBjb25zdCBjb25maWcgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHN0cmluZ1tdfSAqLyAoYXR0cmlidXRlcyB8fCBbXSlcbiAgICB9XG5cbiAgICBpZiAoYWJpbGl0aWVzKSBjb25maWcuYWJpbGl0aWVzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGFiaWxpdGllcylcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIGNvbmZpZy5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKGNvbW1hbmRzKSBjb25maWcuY29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoY29tbWFuZHMpXG4gICAgaWYgKGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMpIGNvbmZpZy5idWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMpXG4gICAgaWYgKGJ1aWx0SW5NZW1iZXJDb21tYW5kcykgY29uZmlnLmJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChidWlsdEluTWVtYmVyQ29tbWFuZHMpXG4gICAgaWYgKGNvbGxlY3Rpb25Db21tYW5kcykgY29uZmlnLmNvbGxlY3Rpb25Db21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChjb2xsZWN0aW9uQ29tbWFuZHMpXG4gICAgaWYgKG1lbWJlckNvbW1hbmRzKSBjb25maWcubWVtYmVyQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAobWVtYmVyQ29tbWFuZHMpXG4gICAgaWYgKG1vZGVsTmFtZSkgY29uZmlnLm1vZGVsTmFtZSA9IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAobW9kZWxOYW1lKVxuICAgIGlmIChwcmltYXJ5S2V5KSBjb25maWcucHJpbWFyeUtleSA9IC8qKiBAdHlwZSB7c3RyaW5nfSAqLyAocHJpbWFyeUtleSlcbiAgICBpZiAocmVsYXRpb25zaGlwcykgY29uZmlnLnJlbGF0aW9uc2hpcHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAocmVsYXRpb25zaGlwcylcbiAgICBpZiAoc2VydmVyKSBjb25maWcuc2VydmVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlcnZlckNvbmZpZ3VyYXRpb259ICovIChzZXJ2ZXIpXG4gICAgaWYgKHN5bmMgIT09IHVuZGVmaW5lZCkgY29uZmlnLnN5bmMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFufSAqLyAoc3luYylcblxuICAgIHJldHVybiBjb25maWdcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXRpYyBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIG1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3MuYClcblxuICAgIHJldHVybiB0aGlzLk1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IC0gQ29udHJvbGxlciBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICBpZiAoIXRoaXMuY29udHJvbGxlcikgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIGluc3RhbmNlLmApXG5cbiAgICByZXR1cm4gdGhpcy5jb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb246IHRoZSBjb250cm9sbGVyJ3Mgd2hlbiB0aGUgcmVzb3VyY2VcbiAgICogc2VydmVzIGEgY29udHJvbGxlciByZXF1ZXN0LCBvdGhlcndpc2UgdGhlIGNvbnN0cnVjdG9yLWluamVjdGVkXG4gICAqIGNvbmZpZ3VyYXRpb24gKGZvciBleGFtcGxlIGEgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCdzIHJlc291cmNlKS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udHJvbGxlcikgcmV0dXJuIHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgaWYgKHRoaXMuY29uZmlndXJhdGlvblZhbHVlKSByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uVmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgY29udHJvbGxlciBvciBhbiBpbmplY3RlZCBjb25maWd1cmF0aW9uLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1RNb2RlbENsYXNzfSAtIE1vZGVsIGNsYXNzLlxuICAgKi9cbiAgbW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxDbGFzc1ZhbHVlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIG1vZGVsIGNsYXNzLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VE1vZGVsQ2xhc3N9ICovICh0aGlzLm1vZGVsQ2xhc3NWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmVkIG1vZGVsIGNsYXNzIGZvciBhdXRob3JpemF0aW9uIGhlbHBlcnMuXG4gICAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgcmVxdWlyZWRNb2RlbENsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNb2RlbCBuYW1lLlxuICAgKi9cbiAgbW9kZWxOYW1lKCkge1xuICAgIGlmICghdGhpcy5tb2RlbE5hbWVWYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBtb2RlbCBuYW1lLmApXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbE5hbWVWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IC0gUGFyYW1zLlxuICAgKi9cbiAgcGFyYW1zKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gKi8gKHRoaXMucGFyYW1zVmFsdWUgfHwgc3VwZXIucGFyYW1zKCkgfHwge30pIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBSZXNvdXJjZSBjb25maWcgKG5vcm1hbGl6ZWQgYXQgcnVudGltZTsgcmF3IGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICAgKi9cbiAgcmVzb3VyY2VDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSByZXNvdXJjZSBjb25maWd1cmF0aW9uLmApXG5cbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBSYWlscy1zdHJvbmctcGFyYW1zIC8gYXBpX21ha2VyLXN0eWxlIHBlcm1pdCBzcGVjIGRlY2xhcmluZ1xuICAgKiB3aGljaCBhdHRyaWJ1dGVzIGFuZCBuZXN0ZWQgYXR0cmlidXRlcyBhcmUgd3JpdGFibGUgZm9yIHRoZSBjdXJyZW50XG4gICAqIHJlcXVlc3QuIFN1Ym1pdHRpbmcgYW4gYXR0cmlidXRlIG9yIG5lc3RlZC1yZWxhdGlvbnNoaXAga2V5IHRoYXQgaXNcbiAgICogbm90IHBlcm1pdHRlZCByYWlzZXMgYW4gZXJyb3IgYW5kIGZhaWxzIHRoZSB3cml0ZS5cbiAgICpcbiAgICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgZmxhdCBhcnJheSB0aGF0IG1peGVzOlxuICAgKiAgIC0gYFwiYXR0cmlidXRlTmFtZVwiYCBzdHJpbmdzIGZvciBwbGFpbiBhdHRyaWJ1dGUgd3JpdGVzXG4gICAqICAgLSBgezxyZWxhdGlvbnNoaXBOYW1lPkF0dHJpYnV0ZXM6IFsuLi5dfWAgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWVcbiAgICogICAgIGlzIGl0c2VsZiBhIHBlcm1pdCBzcGVjIGZvciB0aGUgbmVzdGVkIHJlbGF0aW9uc2hpcFxuICAgKlxuICAgKiBUaGlzIG1hdGNoZXMgUmFpbHMgc3Ryb25nX3BhcmFtcyAoYHBlcm1pdCg6Zmlyc3RfbmFtZSwgOmxhc3RfbmFtZSxcbiAgICogY29udGFjdF9hdHRyaWJ1dGVzOiBbOmVtYWlsLCBkZXRhaWxzX2F0dHJpYnV0ZXM6IFs6ZGV0YWlsXV0pYCkgYW5kXG4gICAqIHRoZSBhcGlfbWFrZXIgc2lzdGVyIHByb2plY3QuIEluY2x1ZGUgYFwiX2Rlc3Ryb3lcImAgaW5zaWRlIGEgbmVzdGVkXG4gICAqIHBlcm1pdCB0byBhbGxvdyBgX2Rlc3Ryb3k6IHRydWVgIGVudHJpZXMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlFxuICAgKiB0aGUgbW9kZWwgbXVzdCBhbHNvIGRlY2xhcmUgYGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUsXG4gICAqIHthbGxvd0Rlc3Ryb3k6IHRydWV9KWAgZm9yIHRoZSBkZXN0cm95IHRvIGJlIGFwcGxpZWQuXG4gICAqXG4gICAqIEV4YW1wbGU6XG4gICAqXG4gICAqICAgY2xhc3MgUHJvamVjdFJlc291cmNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gICAqICAgICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAqICAgICAgIHJldHVybiBbXG4gICAqICAgICAgICAgXCJuYW1lXCIsXG4gICAqICAgICAgICAgXCJkZXNjcmlwdGlvblwiLFxuICAgKiAgICAgICAgIHt0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCIsXG4gICAqICAgICAgICAgICB7c3VidGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAgICogICAgICAgICBdfVxuICAgKiAgICAgICBdXG4gICAqICAgICB9XG4gICAqICAgfVxuICAgKlxuICAgKiBEZWZhdWx0IGltcGxlbWVudGF0aW9uIHJldHVybnMgdGhlIGRlY2xhcmVkXG4gICAqIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLndyaXRhYmxlQXR0cmlidXRlc30gcGVybWl0IGxpc3QsIG9yIGBbXWBcbiAgICog4oCUIG5vdGhpbmcgcGVybWl0dGVkIOKAlCB3aXRob3V0IGEgZGVjbGFyZWQgbGlzdC4gU3ViY2xhc3NlcyBvdmVycmlkZSB0b1xuICAgKiBjdXN0b21pemU7IGFuIGV4cGxpY2l0IG92ZXJyaWRlIGFsd2F5cyB3aW5zLlxuICAgKiBAcGFyYW0ge3thY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhYmlsaXR5PzogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQsIGxvY2Fscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmddIC0gUmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQZXJtaXQgc3BlYy5cbiAgICovXG4gIHBlcm1pdHRlZFBhcmFtcyhhcmcpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwicGVybWl0dGVkUGFyYW1zXCIsIFthcmddLCAoKSA9PiB7XG4gICAgICB2b2lkIGFyZ1xuXG4gICAgICByZXR1cm4gdGhpcy5kZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpID8/IFtdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGVjbGFyZWQgd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0IGZyb20gdGhlIGVudmlyb25tZW50XG4gICAqIHJlc291cmNlIGZpcnN0LCB0aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ug4oCUIG1pcnJvcmluZyBob3cgdGhlIG90aGVyXG4gICAqIHN0YXRpYyByZXNvdXJjZSBjb25maWcgcmVzb2x2ZXMuIEFuIGV4cGxpY2l0IGVudmlyb25tZW50IGRlY2xhcmF0aW9uXG4gICAqIChpbmNsdWRpbmcgYG51bGxgKSB3aW5zIG92ZXIgdGhlIHNoYXJlZCByZXNvdXJjZSdzIGxpc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IERlY2xhcmVkIHBlcm1pdCBsaXN0IG9yIG51bGwgd2hlbiB1bmRlY2xhcmVkLlxuICAgKi9cbiAgZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHBlcm1pdHRlZEF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIndyaXRhYmxlQXR0cmlidXRlc1wiKSlcblxuICAgIHJldHVybiBwZXJtaXR0ZWRBdHRyaWJ1dGVzID8/IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNsaWVudC1zYWZlIGVycm9yIHRocm93biBmb3IgYSBmYWlsZWQgd3JpdGFibGUtYXR0cmlidXRlIHZhbGlkYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gSHVtYW4tcmVhZGFibGUgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tjYXVzZT86IEVycm9yLCBjb2RlOiBzdHJpbmd9fSBkZXRhaWxzIC0gU3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgY29kZSBhbmQgb3B0aW9uYWwgY2F1c2UuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gQ2xpZW50LXNhZmUgZXJyb3IuXG4gICAqL1xuICB3cml0YWJsZUF0dHJpYnV0ZUVycm9yKG1lc3NhZ2UsIHtjYXVzZSwgY29kZX0pIHtcbiAgICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShtZXNzYWdlLCBjYXVzZSA/IHtjYXVzZSwgY29kZX0gOiB7Y29kZX0pXG4gIH1cblxuICAvKipcbiAgICogQXV0aG9yaXplcyBvbmUgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIGJlZm9yZSBpdCBpcyBhcHBsaWVkLlxuICAgKiBEZWZhdWx0cyB0byBhbGxvd2luZyBldmVyeSBtdXRhdGlvbjsgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24gc3RpbGxcbiAgICogYXBwbGllcyB0aHJvdWdoIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlI2ZpbmRTeW5jUmVjb3JkfSBzY29waW5nXG4gICAqIGFuZCB0aGUgY3JlYXRlIG1lbWJlcnNoaXAgY2hlY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbiB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uPn0gQXV0aG9yaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhdXRob3JpemVTeW5jTXV0YXRpb24oe2NvbnRleHQsIG11dGF0aW9ufSkge1xuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgbXV0YXRpb25cblxuICAgIHJldHVybiB7YWxsb3dlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBwZXItc3luYyBmYWlsdXJlIHJlYXNvbiByZXBvcnRlZCB3aGVuIGEgcm91dGVkIHN5bmMgbXV0YXRpb25cbiAgICogZmFpbHMgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24uIERlZmF1bHRzIHRvIG51bGwsIHdoaWNoIHJlcG9ydHMgdGhlXG4gICAqIGdlbmVyaWMgXCJhY2Nlc3MtZGVuaWVkXCIgcmVhc29uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gYXJncy5hY3Rpb24gLSBEZW5pZWQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFN0YWJsZSBmYWlsdXJlIHJlYXNvbiBjb2RlIG9yIG51bGwgZm9yIHRoZSBnZW5lcmljIGRlZmF1bHQuXG4gICAqL1xuICBzeW5jQXV0aG9yaXphdGlvbkZhaWx1cmVSZWFzb24oe2FjdGlvbiwgbXV0YXRpb259KSB7XG4gICAgdm9pZCBhY3Rpb25cbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBleGlzdGluZyByZWNvcmQgdGFyZ2V0ZWQgYnkgYSByb3V0ZWQgc3luYyByZXBsYXkgbXV0YXRpb24uXG4gICAqIERlZmF1bHRzIHRvIGFuIGBhY2Nlc3NpYmxlRm9yYCBsb29rdXAgYnkgcHJpbWFyeSBrZXkgdGhyb3VnaCB0aGVcbiAgICogcmVzb3VyY2UncyBub3JtYWxpemVkIGFiaWxpdHkgYWN0aW9uIGZvciB1cGRhdGUgKG9yIGRlc3Ryb3kgZm9yIGRlbGV0ZVxuICAgKiBtdXRhdGlvbnMpLCBmYWxsaW5nIGJhY2sgdG8gYW4gdW5zY29wZWQgbG9va3VwIHdpdGhvdXQgYW4gYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYXJncy5hYmlsaXR5XSAtIEFiaWxpdHkgb3ZlcnJpZGUuIERlZmF1bHRzIHRvIHRoZSByZXNvdXJjZSBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmZvckRlbGV0ZV0gLSBXaGV0aGVyIHRoZSBsb29rdXAgaXMgZm9yIGEgZGVsZXRlIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gRXhpc3RpbmcgcmVjb3JkIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBmaW5kU3luY1JlY29yZCh7YWJpbGl0eSA9IHRoaXMuYWJpbGl0eSwgZm9yRGVsZXRlID0gZmFsc2UsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyBNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5zeW5jQWJpbGl0eUFjdGlvbihmb3JEZWxldGUgPyBcImRlc3Ryb3lcIiA6IFwidXBkYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgOiBNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeSh7W3ByaW1hcnlLZXldOiBtdXRhdGlvbi5yZXNvdXJjZUlkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgcmF3IHN5bmMgYWN0aW9uIHRvIHRoZSByZXNvdXJjZSdzIG5vcm1hbGl6ZWQgYWJpbGl0eSBhY3Rpb24gd2hlblxuICAgKiB0aGUgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBkZWNsYXJlcyBhbiBhYmlsaXRpZXMgbWFwcGluZywgb3RoZXJ3aXNlIHRoZVxuICAgKiByYXcgYWN0aW9uIG5hbWUgaXMgdXNlZCBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBhY3Rpb24gLSBSYXcgc3luYyBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEFiaWxpdHkgYWN0aW9uLlxuICAgKi9cbiAgc3luY0FiaWxpdHlBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZT8uYWJpbGl0aWVzXG5cbiAgICBpZiAoYWJpbGl0aWVzICYmIHR5cGVvZiBhYmlsaXRpZXMgPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uID09IFwic3RyaW5nXCIgJiYgYWJpbGl0eUFjdGlvbi5sZW5ndGggPiAwKSByZXR1cm4gYWJpbGl0eUFjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGdWxsIGVzY2FwZSBoYXRjaCBmb3Igcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uIFJldHVybmluZyBhXG4gICAqIG5vbi1udWxsIHJlc3VsdCByZXBsYWNlcyB0aGUgd2hvbGUgZGVmYXVsdCBhcHBseSBmbG93IChhdXRob3JpemF0aW9uLFxuICAgKiByZWNvcmQgbG9va3VwLCBub3JtYWxpemF0aW9uIGFuZCBzYXZlKSB3aXRoIHRoZSByZXR1cm5lZCBhcHBseSByZXN1bHQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3N9IGFyZ3MgLSBBcHBseSBhcmdzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGwgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHQgfCBudWxsPn0gQXBwbHkgcmVzdWx0IG9yIG51bGwgZm9yIHRoZSBkZWZhdWx0IGZsb3cuXG4gICAqL1xuICBhcHBseVN5bmMoYXJncykge1xuICAgIHZvaWQgYXJnc1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGEgcm91dGVkIHN5bmMgbXV0YXRpb24gd2FzIGFwcGxpZWQuIFJldHVybmVkIGVudHJpZXMgYXJlXG4gICAqIG1lcmdlZCBpbnRvIHRoZSBhcHBseSByZXN1bHQsIHJlYWNoaW5nIHBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgYW5kXG4gICAqIGJyb2FkY2FzdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY3JlYXRlZCAtIFdoZXRoZXIgdGhlIHJlY29yZCB3YXMgY3JlYXRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBhcmdzLnJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEV4dHJhIGFwcGx5LXJlc3VsdCBlbnRyaWVzLlxuICAgKi9cbiAgYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQsIG11dGF0aW9uLCByZWNvcmR9KSB7XG4gICAgdm9pZCBjb250ZXh0XG4gICAgdm9pZCBjcmVhdGVkXG4gICAgdm9pZCBtdXRhdGlvblxuICAgIHZvaWQgcmVjb3JkXG5cbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGNyZWF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzXCIsIFthdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBvcHRpb25zXG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHVwZGF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwibm9ybWFsaXplVXBkYXRlQXR0cmlidXRlc1wiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBOZXcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyQ3JlYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBVcGRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyVXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZURlc3Ryb3kobW9kZWwpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRGVzdHJveWVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlckRlc3Ryb3lcIiwgW21vZGVsXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV3JhcHMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IHJlc291cmNlIG11dGF0aW9ucy5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBNdXRhdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNdXRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmVzdWx0Pn0gYXJncy5jYWxsYmFjayAtIE11dGF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe2FjdGlvbiwgbW9kZWwsIGNhbGxiYWNrfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJydW5NdXRhdGlvblRyYW5zYWN0aW9uXCIsIFt7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9XSwgYXN5bmMgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cbiAgICAgIHZvaWQgbW9kZWxcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUHJpbWFyeSBrZXkuXG4gICAqL1xuICBwcmltYXJ5S2V5KCkgeyByZXR1cm4gdGhpcy5tb2RlbENsYXNzKCkucHJpbWFyeUtleSgpIH1cblxuICAvKipcbiAgICogUnVucyBhdXRob3JpemVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbn0gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFRNb2RlbENsYXNzPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikge1xuICAgIC8vIE5hcnJvd3MgdGhlIGNvbnRyb2xsZXIgcXVlcnkgdG8gdGhpcyByZXNvdXJjZSdzIG1vZGVsIGNsYXNzLlxuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gUXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1vZGVsQ2xhc3M+fSAtIEZyb250ZW5kLW1vZGVsIGluZGV4IHF1ZXJ5LlxuICAgKi9cbiAgaW5kZXhRdWVyeShvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PFRNb2RlbENsYXNzPn0gKi8gKHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsSW5kZXhRdWVyeSh7XG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgcmVzb3VyY2U6IHRoaXNcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHBhZ2luYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnaW5hdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb259IGFyZ3MucGFnaW5hdGlvbiAtIFBhZ2luYXRpb24gcGFyYW1zLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uKHtjb250cm9sbGVyLCBwYWdpbmF0aW9uLCBxdWVyeX0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFBhZ2luYXRpb24oe3BhZ2luYXRpb24sIHF1ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNlYXJjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBxdWVyeS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeX0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0gYXJncy5zZWFyY2ggLSBTZWFyY2ggcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoKHtjb250cm9sbGVyLCBxdWVyeSwgc2VhcmNofSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGZyb250ZW5kLW1vZGVsIGluZGV4IHNvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU29ydCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU29ydH0gYXJncy5zb3J0IC0gU29ydCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTb3J0KHtjb250cm9sbGVyLCBxdWVyeSwgc29ydH0pIHtcbiAgICBjb250cm9sbGVyLmFwcGx5RnJvbnRlbmRNb2RlbFNvcnQoe3F1ZXJ5LCBzb3J0fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN1cHBvcnRzIHBsdWNrLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgUHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHBsdWNrIGlzIHN1cHBvcnRlZC5cbiAgICovXG4gIHN1cHBvcnRzUGx1Y2soYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykucmVjb3JkcyA9PT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUucmVjb3Jkc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgY291bnQuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgY291bnQgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNDb3VudChhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5yZWNvcmRzID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5yZWNvcmRzIHx8XG4gICAgICBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcykuY291bnQgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLmNvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBBY3Rpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgdm9pZCB8IFByb21pc2U8Ym9vbGVhbiB8IHZvaWQ+fSAtIENvbnRpbnVlIHByb2Nlc3NpbmcgdW5sZXNzIGZhbHNlLlxuICAgKi9cbiAgYmVmb3JlQWN0aW9uKGFjdGlvbikge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVBY3Rpb25cIiwgW2FjdGlvbl0sICgpID0+IHtcbiAgICAgIHZvaWQgYWN0aW9uXG5cbiAgICAgIC8vIE5vLW9wIGJ5IGRlZmF1bHQuXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIFJlY29yZHMgZm9yIGluZGV4IGFjdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlY29yZHMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuaW5kZXhRdWVyeSgpLnRvQXJyYXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5kZXggcXVlcnkgb3B0aW9ucyBmb3IgY291bnQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VJbmRleFF1ZXJ5T3B0aW9uc30gLSBJbmRleCBxdWVyeSBvcHRpb25zIGZvciBjb3VudC5cbiAgICovXG4gIGNvdW50SW5kZXhRdWVyeU9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZWNvcmRzIGNvdW50IGZvciBpbmRleCBhY3Rpb24uXG4gICAqL1xuICBhc3luYyBjb3VudCgpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KHRoaXMuY291bnRJbmRleFF1ZXJ5T3B0aW9ucygpKS5jb3VudCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGlkIC0gUmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIExvY2F0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBmaW5kKGFjdGlvbiwgaWQpIHtcbiAgICBsZXQgcXVlcnkgPSB0aGlzLmF1dGhvcml6ZWRRdWVyeShhY3Rpb24pXG4gICAgY29uc3QgcHJlbG9hZCA9IGFjdGlvbiA9PT0gXCJmaW5kXCIgPyB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbFByZWxvYWQoKSA6IG51bGxcblxuICAgIGlmIChwcmVsb2FkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQocHJlbG9hZClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZmluZEJ5KHtbdGhpcy5wcmltYXJ5S2V5KCldOiBpZH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIENyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBDcmVhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5ub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJjcmVhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzcygpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMubW9kZWxDbGFzcygpLnByb3RvdHlwZSwgTW9kZWxDbGFzcywgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiY3JlYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlQ3JlYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlckNyZWF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgdW5hdXRob3JpemVkIGNyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQ3JlYXRlZCBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ2xlYW51cCBhZnRlciBmYWlsZWQgYXV0aG9yaXphdGlvbi5cbiAgICovXG4gIGFzeW5jIGhhbmRsZVVuYXV0aG9yaXplZENyZWF0ZWRNb2RlbChtb2RlbCkge1xuICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBVcGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gVXBkYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsLCBtb2RlbC5nZXRNb2RlbENsYXNzKCksIGF0dGFjaG1lbnRTcGxpdC5hdHRyaWJ1dGVzLCB0aGlzLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe1xuICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZVVwZGF0ZShtb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgICAgIGNvbnN0IHNhdmVkTW9kZWwgPSBhd2FpdCB0aGlzLl9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9uczogey4uLm9wdGlvbnMsIGF0dGFjaG1lbnRzOiBhdHRhY2htZW50U3BsaXQuYXR0YWNobWVudHN9LCBwZXJtaXR9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJVcGRhdGUoc2F2ZWRNb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG5cbiAgICAgICAgcmV0dXJuIHNhdmVkTW9kZWxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgbW9kZWwgYW5kIGFwcGxpZXMgbmVzdGVkIGF0dHJpYnV0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tmaWx0ZXJlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIG9wdGlvbnM6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zLCBwZXJtaXQ6IHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fX0gYXJncyAtIFNhdmUgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnMsIHBlcm1pdH0pIHtcbiAgICBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MoKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMobW9kZWwsIGZpbHRlcmVkKVxuICAgICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMobW9kZWwsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbCwgcGVybWl0LmF0dHJpYnV0ZXMpXG5cbiAgICAgIGlmIChvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKG1vZGVsLCBvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMsIG9wdGlvbnMuY29udHJvbGxlciB8fCBudWxsLCBwZXJtaXQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICBpZiAob3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhtb2RlbCwgb3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmNvbnRyb2xsZXIgfHwgbnVsbCwgcGVybWl0KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIGF0dHJpYnV0ZXMgdG8gYSBtb2RlbCwgdXNpbmcgdmlydHVhbCBzZXR0ZXJzIG9uIHRoZSByZXNvdXJjZSB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKG1vZGVsLCBhdHRyaWJ1dGVzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZGlyZWN0QXR0cmlidXRlcyA9IHt9XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KFJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXSlcblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX1BdHRyaWJ1dGVgXG4gICAgICBjb25zdCByZXNvdXJjZVNldHRlciA9IHRoaXMucmVzb3VyY2VNZXRob2QocmVzb3VyY2VTZXR0ZXJOYW1lKVxuXG4gICAgICBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgICAgYXdhaXQgcmVzb3VyY2VTZXR0ZXIubWV0aG9kLmNhbGwocmVzb3VyY2VTZXR0ZXIucmVzb3VyY2UsIG1vZGVsLCB2YWx1ZSlcbiAgICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMobmFtZSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGlyZWN0QXR0cmlidXRlc1tuYW1lXSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGRpcmVjdEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIG1vZGVsLmFzc2lnbihkaXJlY3RBdHRyaWJ1dGVzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgYXR0YWNobWVudC1uYW1lZCBhdHRyaWJ1dGVzIGludG8gdGhlIGF0dGFjaG1lbnQgcGF5bG9hZCB3aGlsZSBwcmVzZXJ2aW5nIGxlZ2FjeSBjYWxsZXJzXG4gICAqIHRoYXQgc3VibWl0dGVkIGF0dGFjaG1lbnRzIGFzIG5vcm1hbCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gYXR0YWNobWVudHMgLSBFeHBsaWNpdCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhdHRhY2htZW50czogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH19IEF0dHJpYnV0ZXMgd2l0aCBhdHRhY2htZW50IGtleXMgcmVtb3ZlZCBhbmQgbWVyZ2VkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIF9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMoYXR0cmlidXRlcywgYXR0YWNobWVudHMpIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50c01hcCgpXG4gICAgY29uc3QgYXR0YWNobWVudE5hbWVzID0gbmV3IFNldChPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpKVxuXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lcy5zaXplID09PSAwKSByZXR1cm4ge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzfVxuXG4gICAgaWYgKGF0dGFjaG1lbnRzICE9PSBudWxsICYmICFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlZ3VsYXJBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IG1lcmdlZEF0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgPyB7Li4uYXR0YWNobWVudHN9IDogbnVsbFxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoIWF0dGFjaG1lbnROYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgcmVndWxhckF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1lcmdlZEF0dGFjaG1lbnRzKSBtZXJnZWRBdHRhY2htZW50cyA9IHt9XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1lcmdlZEF0dGFjaG1lbnRzLCBhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJyR7YXR0cmlidXRlTmFtZX0nIHdhcyBzdWJtaXR0ZWQgaW4gYm90aCBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cy5gKVxuICAgICAgfVxuXG4gICAgICBtZXJnZWRBdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHthdHRyaWJ1dGVzOiByZWd1bGFyQXR0cmlidXRlcywgYXR0YWNobWVudHM6IG1lcmdlZEF0dGFjaG1lbnRzfVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhdHRhY2htZW50IHBheWxvYWRzIG9uIGEgbW9kZWwgYWZ0ZXIgdmFsaWRhdGluZyBwZXJtaXRzIGFuZCBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHJlY2VpdmluZyBhdHRhY2htZW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEF0dGFjaG1lbnRzIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGVybWl0dGVkQXR0cmlidXRlTmFtZXMgLSBBdHRyaWJ1dGUvYXR0YWNobWVudCBuYW1lcyBwZXJtaXR0ZWQgYnkgdGhlIHJlc291cmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgYXR0YWNobWVudHMsIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSB7XG4gICAgaWYgKCFhdHRhY2htZW50cykgcmV0dXJuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuXG4gICAgY29uc3QgcGVybWl0U2V0ID0gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcylcbiAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gbW9kZWxDbGFzcy5nZXRBdHRhY2htZW50c01hcCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBub3RQZXJtaXR0ZWRBdHRhY2htZW50cyA9IFtdXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBpbnZhbGlkQXR0YWNobWVudHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghcGVybWl0U2V0LmhhcyhhdHRhY2htZW50TmFtZSkpIHtcbiAgICAgICAgbm90UGVybWl0dGVkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb25zW2F0dGFjaG1lbnROYW1lXSkge1xuICAgICAgICBpbnZhbGlkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbW9kZWwuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkucXVldWVBdHRhY2godmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgbmFtZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgICBpZiAoaW52YWxpZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lczogJHtpbnZhbGlkQXR0YWNobWVudHMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHRyYW5zbGF0ZWQgYXR0cmlidXRlIG9uIGEgbW9kZWwgdmlhIHRoZSB0cmFuc2xhdGlvbnMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gdmFsdWUgLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQ/LmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uID8gY29uZmlndXJhdGlvbi5nZXRMb2NhbGUoKSA6IFwiZW5cIlxuICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwidHJhbnNsYXRpb25zXCIpXG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgdHJhbnNsYXRpb24gPSBsb2FkZWQuZmluZCgodCkgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0KS5sb2NhbGUoKSA9PT0gbG9jYWxlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGF3YWl0IG1vZGVsLmxvYWRSZWxhdGlvbnNoaXAoXCJ0cmFuc2xhdGlvbnNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgdHJhbnNsYXRpb24gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5idWlsZCh7bG9jYWxlfSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IHt9XG5cbiAgICBhc3NpZ25tZW50c1tuYW1lXSA9IHZhbHVlXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveShtb2RlbCkge1xuICAgIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZURlc3Ryb3kobW9kZWwpXG4gICAgICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyRGVzdHJveShtb2RlbClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHRvIHNlcmlhbGl6ZS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwifSBbYWN0aW9uXSAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemUobW9kZWwsIGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY29tbW9uIG1ldGFkYXRhIGZvciBvbmUgbmVzdGVkLWF0dHJpYnV0ZXMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5lc3RlZCByZWxhdGlvbnNoaXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCByZWNlaXZpbmcgbmVzdGVkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgZnJvbSB0aGUgcmVxdWVzdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgY2hpbGQgcmVzb3VyY2UgbG9va3VwLlxuICAgKiBAcmV0dXJucyB7e2FiaWxpdHk6IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBjaGlsZFJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLCBjaGlsZFJlc291cmNlQ29uZmlnOiBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSwgZGVzdHJveVBlcm1pdHRlZDogYm9vbGVhbiwgZW50cmllczogQXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+LCByZWxhdGlvbnNoaXA6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCwgdGFyZ2V0TW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gTmVzdGVkIHJlbGF0aW9uc2hpcCBjb250ZXh0LlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe3BhcmVudCwgcmVsYXRpb25zaGlwTmFtZSwgcmF3RW50cmllcywgY2hpbGRQZXJtaXQsIGNvbnRyb2xsZXJ9KSB7XG4gICAgaWYgKCFjb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgcmVxdWlyZSBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcbiAgICB9XG5cbiAgICBjb25zdCBwYXJlbnRNb2RlbENsYXNzID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IG1vZGVsQWNjZXB0YW5jZSA9IHBhcmVudE1vZGVsQ2xhc3MuYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIW1vZGVsQWNjZXB0YW5jZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWNjZXB0IG5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIERlY2xhcmUgaXQgdmlhICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScpLmApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcGFyZW50TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgIGNvbnN0IHJhd05vcm1hbGl6ZWRFbnRyaWVzID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pXG4gICAgY29uc3QgZGVzdHJveVBlcm1pdHRlZCA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJfZGVzdHJveVwiKVxuXG4gICAgaWYgKGRlc3Ryb3lQZXJtaXR0ZWQgJiYgIW1vZGVsQWNjZXB0YW5jZS5hbGxvd0Rlc3Ryb3kpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgcGVybWl0cyBfZGVzdHJveSBvbiBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IHRoZSBtb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWxsb3cgZGVzdHJveSBmb3IgdGhhdCByZWxhdGlvbnNoaXAuIFNldCB7YWxsb3dEZXN0cm95OiB0cnVlfSBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nLCAuLi4pLmApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLmxpbWl0ID09PSBcIm51bWJlclwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IG1vZGVsQWNjZXB0YW5jZS5saW1pdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZXhjZWVkcyBtb2RlbC1kZWNsYXJlZCBsaW1pdCBvZiAke21vZGVsQWNjZXB0YW5jZS5saW1pdH0uYClcbiAgICB9XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzTWFueVwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGFjY2VwdHMgb25lIGVudHJ5IGZvciAke3JlbGF0aW9uc2hpcFR5cGV9IHJlbGF0aW9uc2hpcHMuYClcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyByZXNvbHZlZCBmb3IgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlQ29uZmlnID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCFjaGlsZFJlc291cmNlQ29uZmlnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdGVyZWQgZm9yIGNoaWxkIG1vZGVsICcke3RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyB1bmRlciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nLmApXG4gICAgfVxuXG4gICAgY29uc3QgY2hpbGRSZXNvdXJjZSA9IG5ldyBjaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCB8fCB7fSxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgbW9kZWxOYW1lOiBjaGlsZFJlc291cmNlQ29uZmlnLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogY29udHJvbGxlci5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfSlcbiAgICBjb25zdCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcyA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIl9kZXN0cm95XCIpXG4gICAgY29uc3QgZW50cmllcyA9IHJhd05vcm1hbGl6ZWRFbnRyaWVzXG4gICAgICAubWFwKChlbnRyeSkgPT4gdGhpcy5fbm9ybWFsaXplTmVzdGVkUmVsYXRpb25zaGlwRW50cnkoe2NoaWxkUGVybWl0LCBlbnRyeSwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pKVxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiBtb2RlbEFjY2VwdGFuY2UucmVqZWN0SWYgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIHRydWVcblxuICAgICAgICByZXR1cm4gIW1vZGVsQWNjZXB0YW5jZS5yZWplY3RJZihpc1BsYWluT2JqZWN0KGVudHJ5LmF0dHJpYnV0ZXMpID8gZW50cnkuYXR0cmlidXRlcyA6IHt9KVxuICAgICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICBhYmlsaXR5OiBjb250cm9sbGVyLmN1cnJlbnRBYmlsaXR5KCkgfHwgdGhpcy5hYmlsaXR5LFxuICAgICAgY2hpbGRSZXNvdXJjZSxcbiAgICAgIGNoaWxkUmVzb3VyY2VDb25maWcsXG4gICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgIGRlc3Ryb3lQZXJtaXR0ZWQsXG4gICAgICBlbnRyaWVzLFxuICAgICAgcmVsYXRpb25zaGlwLFxuICAgICAgdGFyZ2V0TW9kZWxDbGFzc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG5lc3RlZCBlbnRyaWVzIGZvciBjb2xsZWN0aW9uIGFuZCBzaW5ndWxhciByZWxhdGlvbnNoaXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5lc3RlZCBlbnRyaWVzIGlucHV0cy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IGFyZ3MucmF3RW50cmllcyAtIFJhdyBuZXN0ZWQgZW50cmllcyB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBUeXBlIC0gUmVsYXRpb25zaGlwIHR5cGUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeT59IE5vcm1hbGl6ZWQgbmVzdGVkIGVudHJ5IG9iamVjdHMuXG4gICAqL1xuICBfbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pIHtcbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZSA9PT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShyYXdFbnRyaWVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGFycmF5IGZvciBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IGdvdDogJHt0eXBlb2YgcmF3RW50cmllc31gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmF3RW50cmllcy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdChlbnRyeSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzLmApXG5cbiAgICAgICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAoZW50cnkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmIChyYXdFbnRyaWVzID09IG51bGwpIHJldHVybiBbXVxuICAgIGlmIChBcnJheS5pc0FycmF5KHJhd0VudHJpZXMpKSB7XG4gICAgICByZXR1cm4gcmF3RW50cmllcy5tYXAoKGVudHJ5KSA9PiB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdChlbnRyeSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJpZXMgbXVzdCBiZSBvYmplY3RzLmApXG5cbiAgICAgICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAoZW50cnkpXG4gICAgICB9KVxuICAgIH1cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2JqZWN0IGZvciBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IGdvdDogJHt0eXBlb2YgcmF3RW50cmllc31gKVxuICAgIH1cblxuICAgIC8vIE5hcnJvd3MgdGhlIHBsYWluLW9iamVjdCBwYXlsb2FkIHRvIGEgbm9ybWFsaXplZCBuZXN0ZWQtZW50cnkgb2JqZWN0LlxuICAgIHJldHVybiBbLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi8gKHJhd0VudHJpZXMpXVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIG5lc3RlZCBlbnRyeSBmcm9tIGVpdGhlciBpbnRlcm5hbCB0cmFuc3BvcnQgc2hhcGVcbiAgICogKGB7YXR0cmlidXRlcywgYXR0YWNobWVudHMsIG5lc3RlZEF0dHJpYnV0ZXN9YCkgb3IgZGlyZWN0IFJhaWxzLXN0eWxlXG4gICAqIGZpZWxkcyAoYHtuYW1lLCBmaWxlLCBjb21tZW50c0F0dHJpYnV0ZXN9YCkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTm9ybWFsaXphdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MuY2hpbGRQZXJtaXQgLSBQYXJzZWQgY2hpbGQgcGVybWl0IHNwZWMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9IGFyZ3MuZW50cnkgLSBSYXcgbmVzdGVkIGVudHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkuXG4gICAqL1xuICBfbm9ybWFsaXplTmVzdGVkUmVsYXRpb25zaGlwRW50cnkoe2NoaWxkUGVybWl0LCBlbnRyeSwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSAqL1xuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSB0YXJnZXRNb2RlbENsYXNzLmdldEF0dGFjaG1lbnRzTWFwKClcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhlbnRyeSkpIHtcbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImlkXCIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBpZCBtdXN0IGJlIGEgc3RyaW5nIG9yIG51bWJlci5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbm9ybWFsaXplZC5pZCA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcIl9kZXN0cm95XCIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJib29sZWFuXCIpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBfZGVzdHJveSBtdXN0IGJlIGEgYm9vbGVhbi5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbm9ybWFsaXplZC5fZGVzdHJveSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImF0dHJpYnV0ZXNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0LmApXG4gICAgICAgIE9iamVjdC5hc3NpZ24oYXR0cmlidXRlcywgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImF0dGFjaG1lbnRzXCIpIHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgYXR0YWNobWVudHMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRhY2htZW50cywgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcIm5lc3RlZEF0dHJpYnV0ZXNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBuZXN0ZWRBdHRyaWJ1dGVzIG11c3QgYmUgYW4gb2JqZWN0LmApXG4gICAgICAgIE9iamVjdC5hc3NpZ24obmVzdGVkQXR0cmlidXRlcywgdmFsdWUpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lLmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkge1xuICAgICAgICBjb25zdCBuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuXG4gICAgICAgIGlmICghbmVzdGVkUmVsYXRpb25zaGlwTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIG5lc3RlZCBhdHRyaWJ1dGVzIGtleTogJHthdHRyaWJ1dGVOYW1lfWApXG4gICAgICAgIGlmICghY2hpbGRQZXJtaXQubmVzdGVkW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7bmVzdGVkUmVsYXRpb25zaGlwTmFtZX0nIGFyZSBub3QgcGVybWl0dGVkIHVuZGVyICcke3JlbGF0aW9uc2hpcE5hbWV9Jy4gSW5jbHVkZSB7JHthdHRyaWJ1dGVOYW1lfTogWy4uLl19IGluIHRoYXQgbmVzdGVkIHBlcm1pdC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgbmVzdGVkQXR0cmlidXRlc1tuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChhdHRhY2htZW50RGVmaW5pdGlvbnNbYXR0cmlidXRlTmFtZV0pIHtcbiAgICAgICAgYXR0YWNobWVudHNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQuYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0YWNobWVudHMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQuYXR0YWNobWVudHMgPSBhdHRhY2htZW50c1xuICAgIGlmIChPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBub3JtYWxpemVkLm5lc3RlZEF0dHJpYnV0ZXMgPSBuZXN0ZWRBdHRyaWJ1dGVzXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYmVsb25ncy10byBuZXN0ZWQgYXR0cmlidXRlcyBiZWZvcmUgdGhlIHBhcmVudCBzYXZlIHNvIHRoZSBwYXJlbnQgRksgY2FuIGJlIHNldC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IG5lc3RlZEF0dHJpYnV0ZXMgLSBOZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGwgfCB1bmRlZmluZWR9IGNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciByZXNvdXJjZSByZXNvbHV0aW9uIGFuZCBhdXRob3JpemF0aW9uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwgbnVsbH0gW3BhcmVudFBlcm1pdF0gLSBQYXJzZWQgcGFyZW50IHBlcm1pdCBzcGVjLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMocGFyZW50LCBuZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBwYXJlbnRQZXJtaXQgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRQYXJlbnQgPSBwYXJlbnRQZXJtaXRcbiAgICAgIHx8IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwidXBkYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiB7fX0pKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBjaGlsZFBlcm1pdCA9IHJlc29sdmVkUGFyZW50Lm5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIWNoaWxkUGVybWl0KSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7XG4gICAgICAgIGNoaWxkUGVybWl0LFxuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJhd0VudHJpZXM6IG5lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV0sXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb250ZXh0LnJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSB0aGlzLl9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwoY29udGV4dC5yZWxhdGlvbnNoaXAsIHBhcmVudC5nZXRNb2RlbENsYXNzKCkpXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udGV4dC5lbnRyaWVzKSB7XG4gICAgICAgIGlmIChlbnRyeS5fZGVzdHJveSkge1xuICAgICAgICAgIGlmICghY29udGV4dC5kZXN0cm95UGVybWl0dGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSByZXF1ZXN0ZWQgX2Rlc3Ryb3kgYnV0IFwiX2Rlc3Ryb3lcIiBpcyBub3QgaW4gdGhlIHBlcm1pdCBmb3IgdGhpcyByZWxhdGlvbnNoaXAuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuXG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kTmVzdGVkUmVjb3JkKHtcbiAgICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG5cbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuZGVzdHJveShleGlzdGluZylcbiAgICAgICAgICBwYXJlbnQuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIG51bGwpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcbiAgICAgICAgY29uc3QgY2hpbGQgPSBpZCAhPSB1bmRlZmluZWRcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBpZCxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgY2hpbGQuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX2F1dGhvcml6ZUNyZWF0ZWRDaGlsZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZW50cnkubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgfVxuXG4gICAgICAgIHBhcmVudC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgY2hpbGQuaWQoKSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGBuZXN0ZWRBdHRyaWJ1dGVzYCBwYXlsb2FkIHRvIGEgZnJlc2hseS1zYXZlZCBwYXJlbnQgbW9kZWwsXG4gICAqIGNhc2NhZGluZyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgd3JpdGVzIGFjcm9zcyB0aGUgZGVjbGFyZWQgcmVsYXRpb25zaGlwcy5cbiAgICpcbiAgICogRWFjaCBjaGlsZCBpcyBhdXRob3JpemVkIGFnYWluc3QgaXRzIG93biByZXNvdXJjZSdzIGFiaWxpdGllcyAobmV2ZXIgdGhlXG4gICAqIHBhcmVudCdzKS4gRGVzdHJveXMgcnVuIGJlZm9yZSB1cGRhdGVzLCB1cGRhdGVzIGJlZm9yZSBjcmVhdGVzLCB0byBhdm9pZFxuICAgKiB1bmlxdWUtY29uc3RyYWludCBjb25mbGljdHMgd2hlbiByZXBsYWNpbmcgYSBjaGlsZCBhdCB0aGUgc2FtZSBuYXR1cmFsIGtleS5cbiAgICpcbiAgICogQXR0cmlidXRlIGZpbHRlcmluZyBmb3IgbmVzdGVkIGNoaWxkcmVuIHVzZXMgdGhlIHBhcmVudCByZXNvdXJjZSdzXG4gICAqIHBlcm1pdCBzcGVjIGZvciB0aGF0IHJlbGF0aW9uc2hpcCDigJQgYXBpX21ha2VyLXN0eWxlLiBQb2xpY3kgb3B0aW9uc1xuICAgKiAoYWxsb3dEZXN0cm95LCBsaW1pdCwgcmVqZWN0SWYpIGNvbWUgZnJvbSB0aGUgTU9ERUwnc1xuICAgKiBgYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUpYCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IG5lc3RlZEF0dHJpYnV0ZXMgLSBOZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGwgfCB1bmRlZmluZWR9IGNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciByZXNvdXJjZSByZXNvbHV0aW9uIGFuZCBhdXRob3JpemF0aW9uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwgbnVsbH0gW3BhcmVudFBlcm1pdF0gLSBQYXJzZWQgcGFyZW50IHBlcm1pdCBzcGVjLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcHBseU5lc3RlZEF0dHJpYnV0ZXMocGFyZW50LCBuZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBwYXJlbnRQZXJtaXQgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRQYXJlbnQgPSBwYXJlbnRQZXJtaXRcbiAgICAgIHx8IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwidXBkYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiB7fX0pKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBjaGlsZFBlcm1pdCA9IHJlc29sdmVkUGFyZW50Lm5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIWNoaWxkUGVybWl0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9JyBhcmUgbm90IHBlcm1pdHRlZCBieSAke3RoaXMuY29uc3RydWN0b3IubmFtZX0ucGVybWl0dGVkUGFyYW1zKCkuIEluY2x1ZGUgeyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzOiBbLi4uXX0gaW4gdGhlIHJldHVybmVkIHBlcm1pdC5gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7XG4gICAgICAgIGNoaWxkUGVybWl0LFxuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJhd0VudHJpZXM6IG5lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV0sXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb250ZXh0LnJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHBhcmVudExpbmtBdHRyaWJ1dGVzID0gdGhpcy5fcGFyZW50TGlua0F0dHJpYnV0ZXNGb3JOZXN0ZWRDaGlsZCh7XG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmVsYXRpb25zaGlwOiBjb250ZXh0LnJlbGF0aW9uc2hpcCxcbiAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBkZXN0cm95RW50cmllcyA9IFtdXG4gICAgICBjb25zdCB1cGRhdGVFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IGNyZWF0ZUVudHJpZXMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRleHQuZW50cmllcykge1xuICAgICAgICBpZiAoZW50cnk/Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWVudHJ5LmlkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGRlc3Ryb3lFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSBpZiAoZW50cnk/LmlkKSB7XG4gICAgICAgICAgdXBkYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNyZWF0ZUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGRlc3Ryb3lFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcblxuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIGlkLFxuICAgICAgICAgIHBhcmVudCxcbiAgICAgICAgICBwYXJlbnRMaW5rQXR0cmlidXRlcyxcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHVwZGF0ZUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSB1cGRhdGUgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkOiBleGlzdGluZyxcbiAgICAgICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogY29udGV4dC5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgICAgICBlbnRyeVxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcyB8fCB7fSwgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIGF3YWl0IGV4aXN0aW5nLnNhdmUoKVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoZXhpc3RpbmcsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3JlYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBjaGlsZCA9IG5ldyBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGNoaWxkLmFzc2lnbihwYXJlbnRMaW5rQXR0cmlidXRlcylcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgY2hpbGQuc2F2ZSgpXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fYXV0aG9yaXplQ3JlYXRlZENoaWxkKHtcbiAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoZW50cnkubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIG9uZSBuZXN0ZWQgZW50cnkncyBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cyB0byBhIGNoaWxkIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFzc2lnbm1lbnQgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNoaWxkIC0gQ2hpbGQgbW9kZWwgcmVjZWl2aW5nIGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgY2hpbGQgYXR0cmlidXRlIGFuZCBhdHRhY2htZW50IG5hbWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5lbnRyeSAtIE5lc3RlZCBlbnRyeSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe2NoaWxkLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcywgZW50cnl9KSB7XG4gICAgaWYgKGVudHJ5LmF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5LmF0dHJpYnV0ZXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBuZXN0ZWQgZW50cnkgYXR0cmlidXRlcyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhjaGlsZCwgY2hpbGQuZ2V0TW9kZWxDbGFzcygpLCBlbnRyeS5hdHRyaWJ1dGVzLCB0aGlzLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcylcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhjaGlsZCwgZmlsdGVyZWQpXG4gICAgfVxuXG4gICAgaWYgKGVudHJ5LmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQgJiYgIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBuZXN0ZWQgZW50cnkgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIHRoaXMuX2Fzc2lnbkF0dGFjaG1lbnRzKGNoaWxkLCBlbnRyeS5hdHRhY2htZW50cyA/PyBudWxsLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHJlbGF0aW9uc2hpcCdzIGZvcmVpZ24ta2V5IGNvbHVtbi9uYW1lIHRvIHRoZSB0YXJnZXQgbW9kZWwncyBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBjb250YWluaW5nIHRoZSBGSy5cbiAgICogQHJldHVybnMge3N0cmluZ30gRm9yZWlnbi1rZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgbW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV0gfHwgZm9yZWlnbktleVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIEZLIGF0dHJpYnV0ZXMgdGhhdCBiaW5kIGEgbmVzdGVkIGNoaWxkIHRvIGl0cyBwYXJlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFyZW50LWxpbmsgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqL1xuICBfcGFyZW50TGlua0F0dHJpYnV0ZXNGb3JOZXN0ZWRDaGlsZCh7cGFyZW50LCByZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7W2ZvcmVpZ25LZXldOiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKHBhcmVudC5pZCgpKX1cblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSkge1xuICAgICAgY29uc3QgdHlwZUF0dHJpYnV0ZSA9IHRoaXMuX3BvbHltb3JwaGljVHlwZUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgYXR0cmlidXRlc1t0eXBlQXR0cmlidXRlXSA9IHBhcmVudC5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgcmVsYXRpb25zaGlwJ3MgcG9seW1vcnBoaWMgdHlwZSBjb2x1bW4vbmFtZSB0byBhIGNoaWxkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGNvbnRhaW5pbmcgdGhlIHR5cGUgY29sdW1uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQb2x5bW9ycGhpYyB0eXBlIGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgX3BvbHltb3JwaGljVHlwZUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgbW9kZWxDbGFzcykge1xuICAgIGNvbnN0IHR5cGVDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWNUeXBlQ29sdW1uKClcblxuICAgIHJldHVybiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVt0eXBlQ29sdW1uXSB8fCB0eXBlQ29sdW1uXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYW4gYXV0aG9yaXplZCBuZXN0ZWQgcmVjb3JkIGJ5IGlkIHdpdGhvdXQgcGFyZW50IHNjb3BpbmcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTG9va3VwIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5hYmlsaXR5IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge1widXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBhcmdzLmlkIC0gQ2hpbGQgaWQgZnJvbSB0aGUgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEF1dGhvcml6ZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZE5lc3RlZFJlY29yZCh7YWJpbGl0eSwgYWN0aW9uLCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgaWQsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRhcmdldE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcXVlcnkgPSBhYmlsaXR5XG4gICAgICA/IHRhcmdldE1vZGVsQ2xhc3MuYWNjZXNzaWJsZUZvcih0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBhY3Rpb24pLCBhYmlsaXR5KVxuICAgICAgOiB0YXJnZXRNb2RlbENsYXNzLndoZXJlKHt9KVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcXVlcnkuZmluZEJ5KHtbcHJpbWFyeUtleV06IGlkfSlcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90ICR7YWN0aW9ufSBuZXN0ZWQgJHtyZWxhdGlvbnNoaXBOYW1lfVtpZD0ke2lkfV06IHJlY29yZCBub3QgZm91bmQgb3Igbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG5cbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWJpbGl0eSBhY3Rpb24gZm9yIGEgY2hpbGQgcmVzb3VyY2UgdXNpbmcgdGhlIGNoaWxkJ3Mgb3duXG4gICAqIGBhYmlsaXRpZXNgIG1hcHBpbmcg4oCUIG5ldmVyIHRoZSBwYXJlbnQgY29udHJvbGxlcidzLiBUaGlzIHByZXNlcnZlc1xuICAgKiBjdXN0b20gbWFwcGluZ3MgbGlrZSBge3VwZGF0ZTogXCJtYW5hZ2VcIn1gIGFuZCBjYXRjaGVzIHVubWFwcGVkIGFjdGlvbnNcbiAgICogaW5zdGVhZCBvZiBzaWxlbnRseSBkZWZhdWx0aW5nIHRvIHRoZSByYXcgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYmlsaXR5IGFjdGlvbiBmb3IgdGhlIGNoaWxkIHJlc291cmNlLlxuICAgKi9cbiAgX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdGllcyA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uPy5hYmlsaXRpZXNcblxuICAgIGlmICghYWJpbGl0aWVzIHx8IHR5cGVvZiBhYmlsaXRpZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhbiAnYWJpbGl0aWVzJyBvYmplY3QgdG8gYXV0aG9yaXplIG5lc3RlZCAke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAqLyAoYWJpbGl0aWVzKVthY3Rpb25dXG5cbiAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBjaGlsZCByZXNvdXJjZSBtdXN0IGRlZmluZSBhYmlsaXRpZXMuJHthY3Rpb259LmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBleGlzdGluZyBjaGlsZCBmb3IgYSBuZXN0ZWQgdXBkYXRlL2Rlc3Ryb3ksIHNjb3BlZCB0byB0aGVcbiAgICogY2hpbGQncyBvd24gbW9kZWwgY2xhc3MsIHRoZSBwYXJlbnQncyBmb3JlaWduIGtleSwgQU5EIHRoZSBjaGlsZFxuICAgKiByZXNvdXJjZSdzIGFiaWxpdHkgbWFwcGluZyBmb3IgdGhlIHJlcXVlc3RlZCBhY3Rpb24uIFRocm93cyB3aGVuIHRoZVxuICAgKiBjaGlsZCBkb2VzIG5vdCBleGlzdCwgZG9lcyBub3QgYmVsb25nIHRvIHRoZSBjdXJyZW50IHBhcmVudCwgb3IgaXNcbiAgICogbm90IGF1dGhvcml6ZWQg4oCUIGFsbCBvZiB3aGljaCBtdXN0IHJvbGwgdGhlIHRyYW5zYWN0aW9uIGJhY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBhcmdzLnBhcmVudExpbmtBdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0aGF0IHNjb3BlIHRoZSBjaGlsZCB0byB0aGUgcGFyZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgKGZvciBlcnJvciBtZXNzYWdlcykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQsIHBhcmVudC1saW5rZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZFNjb3BlZENoaWxkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcGFyZW50LCBwYXJlbnRMaW5rQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBsb29rdXAgPSB7W3ByaW1hcnlLZXldOiBpZCwgLi4ucGFyZW50TGlua0F0dHJpYnV0ZXN9XG4gICAgY29uc3QgcXVlcnkgPSBhYmlsaXR5XG4gICAgICA/IHRhcmdldE1vZGVsQ2xhc3MuYWNjZXNzaWJsZUZvcih0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBhY3Rpb24pLCBhYmlsaXR5KVxuICAgICAgOiB0YXJnZXRNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkobG9va3VwKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgJHthY3Rpb259IG5lc3RlZCAke3JlbGF0aW9uc2hpcE5hbWV9W2lkPSR7aWR9XTogcmVjb3JkIG5vdCBmb3VuZCwgZG9lcyBub3QgYmVsb25nIHRvIHBhcmVudCAke3BhcmVudC5nZXRNb2RlbENsYXNzKCkubmFtZX1baWQ9JHtwYXJlbnQuaWQoKX1dLCBvciBpcyBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cblxuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGFuIGFscmVhZHktc2F2ZWQgbmVzdGVkIGNoaWxkIGlzIGF1dGhvcml6ZWQgdW5kZXIgdGhlIGNoaWxkXG4gICAqIHJlc291cmNlJ3Mgb3duIGBjcmVhdGVgIGFiaWxpdHkuIFJvbGxzIGJhY2sgdmlhIHRocm93biBlcnJvciB3aGVuIG5vdFxuICAgKiBhdXRob3JpemVkIHNvIHRoZSBvdXRlciB0cmFuc2FjdGlvbiBkZXN0cm95cyB0aGUgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5hYmlsaXR5IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNoaWxkIC0gQ2hpbGQgbW9kZWwgaW5zdGFuY2UganVzdCBjcmVhdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgKGZvciBlcnJvciBtZXNzYWdlcykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXV0aG9yaXplQ3JlYXRlZENoaWxkKHthYmlsaXR5LCBjaGlsZCwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm5cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSB0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBcImNyZWF0ZVwiKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGF1dGhvcml6ZWRJZHMgPSBhd2FpdCB0YXJnZXRNb2RlbENsYXNzXG4gICAgICAuYWNjZXNzaWJsZUZvcihhYmlsaXR5QWN0aW9uLCBhYmlsaXR5KVxuICAgICAgLndoZXJlKHtbcHJpbWFyeUtleV06IGNoaWxkLnJlYWRBdHRyaWJ1dGUocHJpbWFyeUtleSl9KVxuICAgICAgLnBsdWNrKHByaW1hcnlLZXkpXG5cbiAgICBpZiAoYXV0aG9yaXplZElkcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNyZWF0ZSBvbiAke3JlbGF0aW9uc2hpcE5hbWV9WyR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfV0gbm90IGF1dGhvcml6ZWQuYClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWZ0ZXIgbmVzdGVkIHdyaXRlcywgcHJlbG9hZCBldmVyeSByZWxhdGlvbnNoaXAgZGVjbGFyZWQgaW4gdGhlXG4gICAqIHBhcmVudCdzIHBlcm1pdCBzbyB0aGUgcG9zdC1zYXZlIHNlcmlhbGl6ZSBzdGVwIGVtaXRzIHRoZW0gYW5kIHRoZVxuICAgKiBjbGllbnQgY2FuIHJlY29uY2lsZSBpZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gU2F2ZWQgcGFyZW50IG1vZGVsLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBwZXJtaXQgLSBQYXJzZWQgcGFyZW50IHBlcm1pdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcHJlbG9hZE5lc3RlZFdyaXRhYmxlUmVsYXRpb25zaGlwcyhtb2RlbCwgcGVybWl0KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZXMgPSBPYmplY3Qua2V5cyhwZXJtaXQubmVzdGVkKVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcE5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcmVsYXRpb25zaGlwTmFtZXMpIHtcbiAgICAgIGF3YWl0IG1vZGVsLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBQYXJzZXMgdGhlIFJhaWxzL2FwaV9tYWtlci1zdHlsZSBmbGF0IHBlcm1pdCBzcGVjIHJldHVybmVkIGZyb21cbiAqIGBwZXJtaXR0ZWRQYXJhbXMoYXJnKWAgaW50byBhIHN0cnVjdHVyZWQgc2hhcGUgdXNlZCBpbnRlcm5hbGx5IGJ5IHRoZVxuICogd3JpdGUgcGlwZWxpbmUuIFN0cmluZ3MgYmVjb21lIGF0dHJpYnV0ZSBwZXJtaXRzOyBvYmplY3RzIHdob3NlIGtleXNcbiAqIGVuZCBpbiBgQXR0cmlidXRlc2AgYmVjb21lIG5lc3RlZCBwZXJtaXRzICh0aGUga2V5IHByZWZpeCBuYW1lcyB0aGVcbiAqIHJlbGF0aW9uc2hpcCkuXG4gKlxuICogICBwYXJzZVBlcm1pdHRlZFBhcmFtcyhbXCJmaXJzdE5hbWVcIiwgXCJsYXN0TmFtZVwiLFxuICogICAgIHt0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdfVxuICogICBdKVxuICogICAvLyDihpIge1xuICogICAvLyAgIGF0dHJpYnV0ZXM6IFtcImZpcnN0TmFtZVwiLCBcImxhc3ROYW1lXCJdLFxuICogICAvLyAgIG5lc3RlZDoge1xuICogICAvLyAgICAgdGFza3M6IHthdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXSwgbmVzdGVkOiB7fX1cbiAqICAgLy8gICB9XG4gKiAgIC8vIH1cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PiB8IHVuZGVmaW5lZH0gcGVybWl0U3BlYyAtIEZsYXQgcGVybWl0IHNwZWMuXG4gKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn19IC0gUGFyc2VkIHN0cnVjdHVyZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VQZXJtaXR0ZWRQYXJhbXMocGVybWl0U3BlYykge1xuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBhdHRyaWJ1dGVzID0gW11cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59ICovXG4gIGNvbnN0IG5lc3RlZCA9IHt9XG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KHBlcm1pdFNwZWMpKSByZXR1cm4ge2F0dHJpYnV0ZXMsIG5lc3RlZH1cblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBlcm1pdFNwZWMpIHtcbiAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBhdHRyaWJ1dGVzLnB1c2goZW50cnkpXG4gICAgfSBlbHNlIGlmIChlbnRyeSAmJiB0eXBlb2YgZW50cnkgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZW50cnkpKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhlbnRyeSkpIHtcbiAgICAgICAgaWYgKCFrZXkuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogbmVzdGVkIHJlbGF0aW9uc2hpcCBrZXlzIG11c3QgZW5kIGluIFwiQXR0cmlidXRlc1wiIChnb3QgXCIke2tleX1cIikuIFVzZSBcIiR7a2V5fUF0dHJpYnV0ZXNcIiBpbnN0ZWFkLmApXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGtleS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuXG4gICAgICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnk6IGVtcHR5IHJlbGF0aW9uc2hpcCBuYW1lIGluIGtleSBcIiR7a2V5fVwiLmApXG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZXJtaXR0ZWRQYXJhbXMgZW50cnkgZm9yIFwiJHtrZXl9XCI6IGV4cGVjdGVkIGFycmF5IHBlcm1pdCBzcGVjLCBnb3QgJHt0eXBlb2YgdmFsdWV9LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRbcmVsYXRpb25zaGlwTmFtZV0gPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh2YWx1ZSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogZXhwZWN0ZWQgc3RyaW5nIG9yIG5lc3RlZC1hdHRyaWJ1dGVzIG9iamVjdCwgZ290ICR7dHlwZW9mIGVudHJ5fS5gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7YXR0cmlidXRlcywgbmVzdGVkfVxufVxuXG4vKipcbiAqIExvY2F0ZXMgd2hpY2ggcHJvdG90eXBlIG93bnMgYSBtZXRob2QgaW1wbGVtZW50YXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gaW5zdGFuY2UgLSBJbnN0YW5jZSByZWNlaXZpbmcgdGhlIG1ldGhvZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUuXG4gKiBAcmV0dXJucyB7b2JqZWN0IHwgbnVsbH0gLSBQcm90b3R5cGUgdGhhdCBvd25zIHRoZSBtZXRob2QuXG4gKi9cbmZ1bmN0aW9uIHByb3RvdHlwZU93bmVyRm9yTWV0aG9kKGluc3RhbmNlLCBtZXRob2ROYW1lKSB7XG4gIGxldCBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoaW5zdGFuY2UpXG5cbiAgd2hpbGUgKHByb3RvdHlwZSkge1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocHJvdG90eXBlLCBtZXRob2ROYW1lKSkgcmV0dXJuIHByb3RvdHlwZVxuXG4gICAgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHByb3RvdHlwZSlcbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogUnVucyBmaWx0ZXIgd3JpdGFibGUgZnJvbnRlbmQgbW9kZWwgYXR0cmlidXRlcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZWNlaXZlciAtIE1vZGVsIGluc3RhbmNlIG9yIHByb3RvdHlwZS5cbiAqIEBwYXJhbSB7V3JpdGFibGVBdHRyaWJ1dGVSZWNlaXZlckNsYXNzfSByZWNlaXZlckNsYXNzIC0gU3RhdGljIGhlbHBlciBvd25lciBmb3IgdGhlIHJlY2VpdmVyLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgbnVsbH0gW3Jlc291cmNlXSAtIFJlc291cmNlIGluc3RhbmNlIGZvciB2aXJ0dWFsLXNldHRlciBkZXRlY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ1tdIHwgbnVsbH0gW3Blcm1pdHRlZEF0dHJpYnV0ZU5hbWVzXSAtIE9wdGlvbmFsIGV4cGxpY2l0IHBlcm1pdCBsaXN0LiBgbnVsbGAgZmFsbHMgYmFjayB0byBzZXR0ZXItZXhpc3RlbmNlIGNoZWNrcyBvbmx5LlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBXcml0YWJsZSBhdHRyaWJ1dGVzIG9ubHkuXG4gKi9cbmZ1bmN0aW9uIGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMoXG4gIHJlY2VpdmVyLFxuICByZWNlaXZlckNsYXNzLFxuICBhdHRyaWJ1dGVzLFxuICByZXNvdXJjZSA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IG51bGx9ICovIChudWxsKSxcbiAgcGVybWl0dGVkQXR0cmlidXRlTmFtZXMgPSBudWxsXG4pIHtcbiAgLy8gRnJvbnRlbmQtbW9kZWwgd3JpdGVzIHNob3VsZCBmYWlsIGZhc3Qgd2hlbiBjYWxsZXJzIHN1Ym1pdCByZWFkLW9ubHkgb3IgdW5rbm93biBhdHRycy5cbiAgLy8gU2lsZW50IGRyb3BzIGhpZGUgY29udHJhY3QgbWlzdGFrZXMgaW4gZ2VuZXJhdGVkIG1vZGVscyBhbmQgYXBwLXNpZGUgd3JhcHBlciBjb2RlLlxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3Qgd3JpdGFibGVBdHRyaWJ1dGVzID0ge31cbiAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgY29uc3QgaW52YWxpZEF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzID0gW11cblxuICBjb25zdCBwZXJtaXRTZXQgPSBBcnJheS5pc0FycmF5KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSA/IG5ldyBTZXQocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpIDogbnVsbFxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBsZXQgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSBbXVxuXG4gIGlmIChyZXNvdXJjZSkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSAqLyAocmVzb3VyY2UuY29uc3RydWN0b3IpXG5cbiAgICB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IFJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXVxuICB9XG5cbiAgY29uc3QgdHJhbnNsYXRlZFNldCA9IG5ldyBTZXQodHJhbnNsYXRlZEF0dHJpYnV0ZXMpXG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgaWYgKHBlcm1pdFNldCAmJiAhcGVybWl0U2V0LmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgbm90UGVybWl0dGVkQXR0cmlidXRlcy5wdXNoKGF0dHJpYnV0ZU5hbWUpXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHJlY2VpdmVyQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkgfHwgYXR0cmlidXRlTmFtZVxuICAgIGNvbnN0IHJlcXVlc3RlZFNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlc29sdmVkQXR0cmlidXRlTmFtZSl9YFxuICAgIGNvbnN0IHNldHRlck5hbWUgPSByZWNlaXZlckNsYXNzLmZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUocmVjZWl2ZXIsIHJlcXVlc3RlZFNldHRlck5hbWUpIHx8IHJlcXVlc3RlZFNldHRlck5hbWVcbiAgICBjb25zdCByZXNvdXJjZVNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZU5hbWUpfUF0dHJpYnV0ZWBcbiAgICBjb25zdCByZXNvdXJjZVNldHRlciA9IHJlc291cmNlPy5yZXNvdXJjZU1ldGhvZChyZXNvdXJjZVNldHRlck5hbWUpXG5cbiAgICBpZiAoc2V0dGVyTmFtZSBpbiByZWNlaXZlcikge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2UgaWYgKHJlc291cmNlU2V0dGVyKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGludmFsaWRBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gIH1cblxuICBpZiAobm90UGVybWl0dGVkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgRnJvbnRlbmQgbW9kZWwgd3JpdGUgYXR0cmlidXRlcyBub3QgcGVybWl0dGVkIGJ5IHBlcm1pdHRlZFBhcmFtcygpOiAke25vdFBlcm1pdHRlZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgfVxuXG4gIGlmIChpbnZhbGlkQXR0cmlidXRlcy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgSW52YWxpZCBmcm9udGVuZCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzOiAke2ludmFsaWRBdHRyaWJ1dGVzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gIH1cblxuICByZXR1cm4gd3JpdGFibGVBdHRyaWJ1dGVzXG59XG4iXX0=