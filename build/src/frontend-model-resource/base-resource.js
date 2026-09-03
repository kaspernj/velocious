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
        for (const [attachmentName, definition] of Object.entries(this.ModelClass.getAttachmentsMap())) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7OztHQUdHO0FBRUg7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBMEIsU0FBUSx5QkFBeUI7SUFDOUUsK0VBQStFO0lBQy9FLE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRTdCLG1GQUFtRjtJQUNuRixNQUFNLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtJQUM3QixtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsbUhBQW1IO0lBQ25ILE1BQU0sQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFBO0lBQzlCLG1DQUFtQztJQUNuQyxNQUFNLENBQUMsUUFBUSxHQUFHLFNBQVMsQ0FBQTtJQUMzQixtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLGtCQUFrQixHQUFHLFNBQVMsQ0FBQTtJQUNyQyxtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLHlCQUF5QixHQUFHLFNBQVMsQ0FBQTtJQUM1QyxtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7SUFDakMsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxxQkFBcUIsR0FBRyxTQUFTLENBQUE7SUFDeEMsbUNBQW1DO0lBQ25DLE1BQU0sQ0FBQyxhQUFhLEdBQUcsU0FBUyxDQUFBO0lBQ2hDLGlDQUFpQztJQUNqQyxNQUFNLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQTtJQUM1QixpQ0FBaUM7SUFDakMsTUFBTSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUE7SUFDN0IsdUdBQXVHO0lBQ3ZHLE1BQU0sQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFBO0lBQ3pCLCtHQUErRztJQUMvRyxNQUFNLENBQUMsSUFBSSxHQUFHLFNBQVMsQ0FBQTtJQUN2QixtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLG9CQUFvQixHQUFHLFNBQVMsQ0FBQTtJQUN2Qyw0Q0FBNEM7SUFDNUMsTUFBTSxDQUFDLGNBQWMsR0FBRyxTQUFTLENBQUE7SUFFakM7Ozs7Ozs7NkNBT3lDO0lBQ3pDLE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxTQUFTLENBQUE7SUFFckM7OztPQUdHO0lBQ0gsWUFBWSxJQUFJO1FBQ2QsS0FBSyxDQUFDO1lBQ0osT0FBTyxFQUFFLFNBQVMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDckQsT0FBTyxFQUFFLFNBQVMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ3BELE1BQU0sRUFBRSxRQUFRLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRTtTQUNsRCxDQUFDLENBQUE7UUFFRixNQUFNLGFBQWEsR0FBRywrQ0FBK0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUN4RixNQUFNLDRCQUE0QixHQUFHLHFGQUFxRixDQUFDLENBQUMsRUFBQyxVQUFVLEVBQUUsRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUU3SSxJQUFJLENBQUMsVUFBVSxHQUFHLFlBQVksSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUNwRSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsZUFBZSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxlQUFlLEdBQUcsWUFBWSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQzFGLElBQUksQ0FBQyxjQUFjLEdBQUcsV0FBVyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLFlBQVksRUFBRSxDQUFBO1FBQzdGLElBQUksQ0FBQyxXQUFXLEdBQUcsUUFBUSxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQzdELElBQUksQ0FBQywwQkFBMEIsR0FBRyx1QkFBdUIsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsNEJBQTRCLENBQUE7UUFDN0gsMkRBQTJEO1FBQzNELElBQUksQ0FBQywyQkFBMkIsR0FBRyxTQUFTLENBQUE7SUFDOUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxtQkFBbUI7UUFDeEIsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFBO0lBQzVCLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJO1FBQ25DLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLFNBQVM7WUFBRSxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUUvQyxNQUFNLGNBQWMsR0FBRywyREFBMkQsQ0FBQyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLENBQUE7UUFFL0csSUFBSSxDQUFDLGNBQWM7WUFBRSxPQUFPLFNBQVMsQ0FBQTtRQUNyQyxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxTQUFTO1lBQUUsT0FBTyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFbkUsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQywwQkFBMEI7UUFDL0IsT0FBTyxtQ0FBbUMsQ0FBQyxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUE7SUFDckcsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsd0JBQXdCO1FBQzdCLE1BQU0scUJBQXFCLEdBQUcsbUhBQW1ILENBQUMsQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQTtRQUNqTSxNQUFNLFdBQVcsR0FBRyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsRUFBQyxHQUFHLHFCQUFxQixFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQTtRQUUzRSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLFdBQVcsQ0FBQTtRQUV4QyxLQUFLLE1BQU0sQ0FBQyxjQUFjLEVBQUUsVUFBVSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUMsRUFBRSxDQUFDO1lBQy9GLE1BQU0sZ0JBQWdCLEdBQUcsdUZBQXVGLENBQUMsQ0FBQyxFQUFDLElBQUksRUFBRSxVQUFVLENBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtZQUUxSSxJQUFJLFVBQVUsQ0FBQyxJQUFJO2dCQUFFLGdCQUFnQixDQUFDLElBQUksR0FBRyxFQUFDLEdBQUcsVUFBVSxDQUFDLElBQUksRUFBQyxDQUFBO1lBRWpFLFdBQVcsQ0FBQyxjQUFjLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQTtRQUNoRCxDQUFDO1FBRUQsT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILHNCQUFzQjtRQUNwQixJQUFJLElBQUksQ0FBQywyQkFBMkIsS0FBSyxTQUFTO1lBQUUsT0FBTyxJQUFJLENBQUMsMkJBQTJCLENBQUE7UUFFM0YsTUFBTSxhQUFhLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDeEYsTUFBTSxjQUFjLEdBQUcsMkRBQTJELENBQUMsQ0FBQyxhQUFhLENBQUMsbUJBQW1CLEVBQUUsQ0FBQyxDQUFBO1FBRXhILElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUNwQixJQUFJLENBQUMsMkJBQTJCLEdBQUcsSUFBSSxDQUFBO1lBQ3ZDLE9BQU8sSUFBSSxDQUFDLDJCQUEyQixDQUFBO1FBQ3pDLENBQUM7UUFFRCxJQUFJLGNBQWMsS0FBSyxhQUFhLEVBQUUsQ0FBQztZQUNyQyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsYUFBYSxDQUFDLElBQUkseUNBQXlDLENBQUMsQ0FBQTtRQUNqRixDQUFDO1FBRUQsSUFBSSxDQUFDLDJCQUEyQixHQUFHLElBQUksY0FBYyxDQUFDO1lBQ3BELE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNuQixVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRTtZQUM3QixTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUMzQixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUNyQixxQkFBcUIsRUFBRSxJQUFJLENBQUMscUJBQXFCLEVBQUU7U0FDcEQsQ0FBQyxDQUFBO1FBRUYsT0FBTyxJQUFJLENBQUMsMkJBQTJCLENBQUE7SUFDekMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsd0JBQXdCLENBQUMsVUFBVSxFQUFFLElBQUk7UUFDdkMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFFcEQsSUFBSSxDQUFDLGNBQWM7WUFBRSxPQUFPLEVBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFDLENBQUE7UUFFOUQsTUFBTSxXQUFXLEdBQUcsdUJBQXVCLENBQUMsY0FBYyxFQUFFLFVBQVUsQ0FBQyxDQUFBO1FBRXZFLElBQUksQ0FBQyxXQUFXLElBQUksV0FBVyxLQUFLLHlCQUF5QixDQUFDLFNBQVMsSUFBSSxXQUFXLEtBQUsseUJBQXlCLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDL0gsT0FBTyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxvRUFBb0UsQ0FBQyxFQUFDLHNCQUF1QixDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFekksT0FBTyxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFDLENBQUE7SUFDbkUsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxzQkFBc0IsQ0FBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLFFBQVE7UUFDL0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsQ0FBQTtRQUVwRSxJQUFJLFlBQVksQ0FBQyxNQUFNO1lBQUUsT0FBTyxxQkFBcUIsQ0FBQyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUzRSxPQUFPLFFBQVEsRUFBRSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsY0FBYyxDQUFDLFVBQVU7UUFDdkIsTUFBTSxTQUFTLEdBQUcsc0NBQXNDLENBQUMsRUFBQyxzQkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRXBHLElBQUksT0FBTyxTQUFTLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDcEMsT0FBTztnQkFDTCxNQUFNLEVBQUUsb0RBQW9ELENBQUMsQ0FBQyxTQUFTLENBQUM7Z0JBQ3hFLFFBQVEsRUFBRSxJQUFJO2FBQ2YsQ0FBQTtRQUNILENBQUM7UUFFRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQTtRQUVwRCxJQUFJLENBQUMsY0FBYztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRWhDLE1BQU0sWUFBWSxHQUFHLHNDQUFzQyxDQUFDLEVBQUMsc0JBQXVCLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVqSCxJQUFJLE9BQU8sWUFBWSxLQUFLLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVuRCxPQUFPO1lBQ0wsTUFBTSxFQUFFLG9EQUFvRCxDQUFDLENBQUMsWUFBWSxDQUFDO1lBQzNFLFFBQVEsRUFBRSxjQUFjO1NBQ3pCLENBQUE7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsU0FBUztRQUNQLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBQy9ELENBQUM7SUFFRDs7O09BR0c7SUFDSCx1QkFBdUI7UUFDckIsT0FBTyw4Q0FBOEMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN6RSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLGNBQWM7UUFDbkIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBQy9ELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUM3RCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsQ0FBQTtRQUNuRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDM0QsTUFBTSx5QkFBeUIsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsMkJBQTJCLENBQUMsQ0FBQTtRQUM3RixNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1FBQ3JGLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLG9CQUFvQixDQUFDLENBQUE7UUFDL0UsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDdkUsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBQzdELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUMvRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDckUsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ3ZELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUNuRCxxRkFBcUY7UUFDckYsTUFBTSxNQUFNLEdBQUc7WUFDYixVQUFVLEVBQUUsdUVBQXVFLENBQUMsQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDO1NBQ3ZHLENBQUE7UUFFRCxJQUFJLFNBQVM7WUFBRSxNQUFNLENBQUMsU0FBUyxHQUFHLHVCQUF1QixDQUFDLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDckUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsTUFBTSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUE7UUFDekUsSUFBSSxRQUFRO1lBQUUsTUFBTSxDQUFDLFFBQVEsR0FBRyx1QkFBdUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQ2xFLElBQUkseUJBQXlCO1lBQUUsTUFBTSxDQUFDLHlCQUF5QixHQUFHLHVCQUF1QixDQUFDLENBQUMseUJBQXlCLENBQUMsQ0FBQTtRQUNySCxJQUFJLHFCQUFxQjtZQUFFLE1BQU0sQ0FBQyxxQkFBcUIsR0FBRyx1QkFBdUIsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDekcsSUFBSSxrQkFBa0I7WUFBRSxNQUFNLENBQUMsa0JBQWtCLEdBQUcsdUJBQXVCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBQ2hHLElBQUksY0FBYztZQUFFLE1BQU0sQ0FBQyxjQUFjLEdBQUcsdUJBQXVCLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUNwRixJQUFJLFNBQVM7WUFBRSxNQUFNLENBQUMsU0FBUyxHQUFHLHFCQUFxQixDQUFDLENBQUMsU0FBUyxDQUFDLENBQUE7UUFDbkUsSUFBSSxVQUFVO1lBQUUsTUFBTSxDQUFDLFVBQVUsR0FBRyxxQkFBcUIsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3RFLElBQUksYUFBYTtZQUFFLE1BQU0sQ0FBQyxhQUFhLEdBQUcsdUJBQXVCLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUNqRixJQUFJLE1BQU07WUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLDJGQUEyRixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDaEksSUFBSSxJQUFJLEtBQUssU0FBUztZQUFFLE1BQU0sQ0FBQyxJQUFJLEdBQUcsbUdBQW1HLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVoSixPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsVUFBVTtRQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxnQ0FBZ0MsQ0FBQyxDQUFBO1FBRW5GLE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsa0JBQWtCO1FBQ2hCLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksa0NBQWtDLENBQUMsQ0FBQTtRQUVqRyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsYUFBYTtRQUNYLElBQUksSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDeEUsSUFBSSxJQUFJLENBQUMsa0JBQWtCO1lBQUUsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUE7UUFFM0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxzREFBc0QsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxVQUFVO1FBQ1IsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLDBCQUEwQixDQUFDLENBQUE7UUFDckUsQ0FBQztRQUVELE9BQU8sMEJBQTBCLENBQUMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7SUFDMUQsQ0FBQztJQUVEOzs7T0FHRztJQUNILGtCQUFrQjtRQUNoQixPQUFPLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUMxQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsU0FBUztRQUNQLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUkseUJBQXlCLENBQUMsQ0FBQTtRQUU1RixPQUFPLElBQUksQ0FBQyxjQUFjLENBQUE7SUFDNUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sS0FBSyxPQUFPLGtFQUFrRSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUEsQ0FBQyxDQUFDO0lBRWpJOzs7T0FHRztJQUNILHFCQUFxQjtRQUNuQixJQUFJLENBQUMsSUFBSSxDQUFDLDBCQUEwQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUkscUNBQXFDLENBQUMsQ0FBQTtRQUVwSCxPQUFPLElBQUksQ0FBQywwQkFBMEIsQ0FBQTtJQUN4QyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Bc0NHO0lBQ0gsZUFBZSxDQUFDLEdBQUc7UUFDakIsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDaEUsS0FBSyxHQUFHLENBQUE7WUFFUixPQUFPLElBQUksQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQTtRQUNoRCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCwwQkFBMEI7UUFDeEIsTUFBTSxhQUFhLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDeEYsTUFBTSxtQkFBbUIsR0FBRywwQ0FBMEMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyx5QkFBeUIsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUE7UUFFdEksT0FBTyxtQkFBbUIsSUFBSSxJQUFJLENBQUE7SUFDcEMsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsc0JBQXNCLENBQUMsT0FBTyxFQUFFLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBQztRQUMzQyxPQUFPLGNBQWMsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUMsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUNyRSxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gscUJBQXFCLENBQUMsRUFBQyxPQUFPLEVBQUUsUUFBUSxFQUFDO1FBQ3ZDLEtBQUssT0FBTyxDQUFBO1FBQ1osS0FBSyxRQUFRLENBQUE7UUFFYixPQUFPLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILDhCQUE4QixDQUFDLEVBQUMsTUFBTSxFQUFFLFFBQVEsRUFBQztRQUMvQyxLQUFLLE1BQU0sQ0FBQTtRQUNYLEtBQUssUUFBUSxDQUFBO1FBRWIsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsRUFBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxTQUFTLEdBQUcsS0FBSyxFQUFFLFFBQVEsRUFBQztRQUN4RSxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDcEMsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQzFDLE1BQU0sS0FBSyxHQUFHLE9BQU87WUFDbkIsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsRUFBRSxPQUFPLENBQUM7WUFDN0YsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFeEIsT0FBTyxNQUFNLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUMsQ0FBQyxDQUFBO0lBQ2hFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxpQkFBaUIsQ0FBQyxNQUFNO1FBQ3RCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQywwQkFBMEIsRUFBRSxTQUFTLENBQUE7UUFFNUQsSUFBSSxTQUFTLElBQUksT0FBTyxTQUFTLElBQUksUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQzNFLE1BQU0sYUFBYSxHQUFHLDREQUE0RCxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFdEcsSUFBSSxPQUFPLGFBQWEsSUFBSSxRQUFRLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDO2dCQUFFLE9BQU8sYUFBYSxDQUFBO1FBQ3hGLENBQUM7UUFFRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxTQUFTLENBQUMsSUFBSTtRQUNaLEtBQUssSUFBSSxDQUFBO1FBRVQsT0FBTyxJQUFJLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILGNBQWMsQ0FBQyxFQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBQztRQUNqRCxLQUFLLE9BQU8sQ0FBQTtRQUNaLEtBQUssT0FBTyxDQUFBO1FBQ1osS0FBSyxRQUFRLENBQUE7UUFDYixLQUFLLE1BQU0sQ0FBQTtRQUVYLE9BQU8sRUFBRSxDQUFBO0lBQ1gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gseUJBQXlCLENBQUMsVUFBVSxFQUFFLE9BQU87UUFDM0MsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsMkJBQTJCLEVBQUUsQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLEVBQUUsR0FBRyxFQUFFO1lBQzFGLEtBQUssT0FBTyxDQUFBO1lBRVosT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gseUJBQXlCLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPO1FBQ2xELE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLDJCQUEyQixFQUFFLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDakcsS0FBSyxLQUFLLENBQUE7WUFDVixLQUFLLE9BQU8sQ0FBQTtZQUVaLE9BQU8sVUFBVSxDQUFBO1FBQ25CLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILFlBQVksQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU87UUFDckMsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsY0FBYyxFQUFFLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDcEYsS0FBSyxLQUFLLENBQUE7WUFDVixLQUFLLFVBQVUsQ0FBQTtZQUNmLEtBQUssT0FBTyxDQUFBO1FBQ2QsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsV0FBVyxDQUFDLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTztRQUNwQyxPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxFQUFFLEdBQUcsRUFBRTtZQUNuRixLQUFLLEtBQUssQ0FBQTtZQUNWLEtBQUssVUFBVSxDQUFBO1lBQ2YsS0FBSyxPQUFPLENBQUE7UUFDZCxDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxZQUFZLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPO1FBQ3JDLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLGNBQWMsRUFBRSxDQUFDLEtBQUssRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLEVBQUUsR0FBRyxFQUFFO1lBQ3BGLEtBQUssS0FBSyxDQUFBO1lBQ1YsS0FBSyxVQUFVLENBQUE7WUFDZixLQUFLLE9BQU8sQ0FBQTtRQUNkLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILFdBQVcsQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU87UUFDcEMsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsYUFBYSxFQUFFLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDbkYsS0FBSyxLQUFLLENBQUE7WUFDVixLQUFLLFVBQVUsQ0FBQTtZQUNmLEtBQUssT0FBTyxDQUFBO1FBQ2QsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxLQUFLO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLGVBQWUsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLEdBQUcsRUFBRTtZQUNoRSxLQUFLLEtBQUssQ0FBQTtRQUNaLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxZQUFZLENBQUMsS0FBSztRQUNoQixPQUFPLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxHQUFHLEVBQUU7WUFDL0QsS0FBSyxLQUFLLENBQUE7UUFDWixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFDO1FBQ3BELE9BQU8sTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUMsd0JBQXdCLEVBQUUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFDLENBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN6RyxLQUFLLE1BQU0sQ0FBQTtZQUNYLEtBQUssS0FBSyxDQUFBO1lBRVYsT0FBTyxNQUFNLFFBQVEsRUFBRSxDQUFBO1FBQ3pCLENBQUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7T0FHRztJQUNILFVBQVUsS0FBSyxPQUFPLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxVQUFVLEVBQUUsQ0FBQSxDQUFDLENBQUM7SUFFdEQ7Ozs7T0FJRztJQUNILGVBQWUsQ0FBQyxNQUFNO1FBQ3BCLCtEQUErRDtRQUMvRCxPQUFPLG9GQUFvRixDQUFDLENBQUMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUMsbUNBQW1DLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtJQUMxSyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFVBQVUsQ0FBQyxPQUFPLEdBQUcsRUFBRTtRQUNyQixPQUFPLG9GQUFvRixDQUFDLENBQUMsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUMsdUJBQXVCLENBQUM7WUFDbEosR0FBRyxPQUFPO1lBQ1YsUUFBUSxFQUFFLElBQUk7U0FDZixDQUFDLENBQUMsQ0FBQTtJQUNMLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsaUNBQWlDLENBQUMsRUFBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBQztRQUMvRCxVQUFVLENBQUMsNEJBQTRCLENBQUMsRUFBQyxVQUFVLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDZCQUE2QixDQUFDLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUM7UUFDdkQsVUFBVSxDQUFDLHdCQUF3QixDQUFDLEVBQUMsS0FBSyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7SUFDdEQsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCwyQkFBMkIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFDO1FBQ25ELFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO0lBQ2xELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLE1BQU07UUFDbEIsS0FBSyxNQUFNLENBQUE7UUFFWCxPQUFPLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxLQUFLLHlCQUF5QixDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUE7SUFDNUYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsTUFBTTtRQUNsQixLQUFLLE1BQU0sQ0FBQTtRQUVYLE9BQU8sTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEtBQUsseUJBQXlCLENBQUMsU0FBUyxDQUFDLE9BQU87WUFDeEYsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUsseUJBQXlCLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQTtJQUNuRixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFlBQVksQ0FBQyxNQUFNO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLHNCQUFzQixDQUFDLGNBQWMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEdBQUcsRUFBRTtZQUNoRSxLQUFLLE1BQU0sQ0FBQTtZQUVYLG9CQUFvQjtRQUN0QixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsT0FBTztRQUNYLE9BQU8sTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDMUMsQ0FBQztJQUVEOzs7T0FHRztJQUNILHNCQUFzQjtRQUNwQixPQUFPLEVBQUUsQ0FBQTtJQUNYLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsS0FBSztRQUNULE9BQU8sTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUE7SUFDckUsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRTtRQUNuQixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3hDLE1BQU0sT0FBTyxHQUFHLE1BQU0sS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDLG9CQUFvQixFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUVoRyxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQ1osS0FBSyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUE7UUFDaEMsQ0FBQztRQUVELE9BQU8sTUFBTSxLQUFLLENBQUMsTUFBTSxDQUFDLEVBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUMsQ0FBQyxDQUFBO0lBQ3RELENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQ25DLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBQ3RGLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxvQkFBb0IsRUFBRSxPQUFPLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxDQUFBO1FBQzVHLE1BQU0sTUFBTSxHQUFHLG9CQUFvQixDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsRUFBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxvQkFBb0IsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUN2SixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDcEMsTUFBTSxRQUFRLEdBQUcscUNBQXFDLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLFNBQVMsRUFBRSxVQUFVLEVBQUUsZUFBZSxDQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3BKLE1BQU0sS0FBSyxHQUFHLElBQUksVUFBVSxFQUFFLENBQUE7UUFFOUIsT0FBTyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztZQUN2QyxNQUFNLEVBQUUsUUFBUTtZQUNoQixLQUFLO1lBQ0wsUUFBUSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNuQixNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxDQUFBO2dCQUM3RCxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsV0FBVyxFQUFFLGVBQWUsQ0FBQyxXQUFXLEVBQUMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO2dCQUVuSixNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsVUFBVSxFQUFFLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxDQUFBO2dCQUVqRSxPQUFPLFVBQVUsQ0FBQTtZQUNuQixDQUFDO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsS0FBSztRQUN4QyxNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUN2QixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sR0FBRyxFQUFFO1FBQzFDLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUM3RixNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsQ0FBQTtRQUM1RyxNQUFNLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsb0JBQW9CLEVBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdkosTUFBTSxRQUFRLEdBQUcscUNBQXFDLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxhQUFhLEVBQUUsRUFBRSxlQUFlLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFekksT0FBTyxNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztZQUN2QyxNQUFNLEVBQUUsUUFBUTtZQUNoQixLQUFLO1lBQ0wsUUFBUSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNuQixNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxDQUFBO2dCQUM3RCxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsV0FBVyxFQUFFLGVBQWUsQ0FBQyxXQUFXLEVBQUMsRUFBRSxNQUFNLEVBQUMsQ0FBQyxDQUFBO2dCQUVuSixNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsVUFBVSxFQUFFLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxDQUFBO2dCQUVqRSxPQUFPLFVBQVUsQ0FBQTtZQUNuQixDQUFDO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMseUJBQXlCLENBQUMsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUM7UUFDaEUsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzdDLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQTtZQUNyRCxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxXQUFXLElBQUksSUFBSSxFQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUU5RSxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1lBQ2pILENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUVsQixJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUM3QixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFBO1lBQ3hHLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQTtRQUVGLE1BQU0sSUFBSSxDQUFDLG1DQUFtQyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQTtRQUU3RCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsVUFBVTtRQUMvQyw0REFBNEQ7UUFDNUQsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7UUFDM0IsTUFBTSxhQUFhLEdBQUcsK0NBQStDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUE7UUFDeEYsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLDBCQUEwQixFQUFFLElBQUksRUFBRSxDQUFDLENBQUE7UUFFL0UsS0FBSyxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUN2RCxNQUFNLGtCQUFrQixHQUFHLE1BQU0sVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFBO1lBQ3JFLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUU5RCxJQUFJLGNBQWMsRUFBRSxDQUFDO2dCQUNuQixNQUFNLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFBO1lBQ3pFLENBQUM7aUJBQU0sSUFBSSxhQUFhLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sSUFBSSxDQUFDLDhCQUE4QixDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUE7WUFDL0QsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGdCQUFnQixDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQTtZQUNoQyxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxLQUFLLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDaEMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCw0QkFBNEIsQ0FBQyxVQUFVLEVBQUUsV0FBVztRQUNsRCxNQUFNLHFCQUFxQixHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFBO1FBQ25FLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFBO1FBRW5FLElBQUksZUFBZSxDQUFDLElBQUksS0FBSyxDQUFDO1lBQUUsT0FBTyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUMsQ0FBQTtRQUVoRSxJQUFJLFdBQVcsS0FBSyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUN4RCxNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUE7UUFDMUQsQ0FBQztRQUVELDREQUE0RDtRQUM1RCxNQUFNLGlCQUFpQixHQUFHLEVBQUUsQ0FBQTtRQUM1QixtRUFBbUU7UUFDbkUsSUFBSSxpQkFBaUIsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUMsR0FBRyxXQUFXLEVBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFBO1FBRTdELEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDaEUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztnQkFDeEMsaUJBQWlCLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFBO2dCQUN4QyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksQ0FBQyxpQkFBaUI7Z0JBQUUsaUJBQWlCLEdBQUcsRUFBRSxDQUFBO1lBQzlDLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQzNFLE1BQU0sSUFBSSxLQUFLLENBQUMsZUFBZSxhQUFhLHFEQUFxRCxDQUFDLENBQUE7WUFDcEcsQ0FBQztZQUVELGlCQUFpQixDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMxQyxDQUFDO1FBRUQsT0FBTyxFQUFDLFVBQVUsRUFBRSxpQkFBaUIsRUFBRSxXQUFXLEVBQUUsaUJBQWlCLEVBQUMsQ0FBQTtJQUN4RSxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsa0JBQWtCLENBQUMsS0FBSyxFQUFFLFdBQVcsRUFBRSx1QkFBdUI7UUFDNUQsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFNO1FBQ3hCLElBQUksQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFBO1FBRXpGLE1BQU0sU0FBUyxHQUFHLElBQUksR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUE7UUFDbEQsTUFBTSxVQUFVLEdBQUcsS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQ3hDLE1BQU0scUJBQXFCLEdBQUcsVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFDNUQsdUJBQXVCO1FBQ3ZCLE1BQU0sdUJBQXVCLEdBQUcsRUFBRSxDQUFBO1FBQ2xDLHVCQUF1QjtRQUN2QixNQUFNLGtCQUFrQixHQUFHLEVBQUUsQ0FBQTtRQUU3QixLQUFLLE1BQU0sQ0FBQyxjQUFjLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1lBQ2xFLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7Z0JBQ25DLHVCQUF1QixDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQTtnQkFDNUMsU0FBUTtZQUNWLENBQUM7WUFDRCxJQUFJLENBQUMscUJBQXFCLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztnQkFDM0Msa0JBQWtCLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBO2dCQUN2QyxTQUFRO1lBQ1YsQ0FBQztZQUVELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxjQUFjLENBQUMsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDOUQsQ0FBQztRQUVELElBQUksdUJBQXVCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyx1RUFBdUUsdUJBQXVCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO1FBQ2xMLENBQUM7UUFDRCxJQUFJLGtCQUFrQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsQyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsNENBQTRDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtRQUNsSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEtBQUs7UUFDckQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUE7UUFDakQsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUMvRCxNQUFNLG9CQUFvQixHQUFHLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxjQUFjLENBQUMsQ0FBQTtRQUV4RSx3RUFBd0U7UUFDeEUsSUFBSSxXQUFXLENBQUE7UUFFZixJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQ3hCLE1BQU0sTUFBTSxHQUFHLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFBO1lBRTVDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUMxQixXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsNERBQTRELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxNQUFNLENBQUMsQ0FBQTtZQUN4SCxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixJQUFJLENBQUMsb0JBQW9CLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQztnQkFDekMsTUFBTSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsY0FBYyxDQUFDLENBQUE7WUFDOUMsQ0FBQztZQUVELE1BQU0sTUFBTSxHQUFHLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFBO1lBRTVDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUMxQixXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsNERBQTRELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxNQUFNLENBQUMsQ0FBQTtZQUN4SCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqQixXQUFXLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLEVBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUNwRCxDQUFDO1FBRUQsNERBQTREO1FBQzVELE1BQU0sV0FBVyxHQUFHLEVBQUUsQ0FBQTtRQUV0QixXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFBO1FBQ3pCLFdBQVcsQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUE7SUFDakMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUs7UUFDakIsTUFBTSxJQUFJLENBQUMsc0JBQXNCLENBQUM7WUFDaEMsTUFBTSxFQUFFLFNBQVM7WUFDakIsS0FBSztZQUNMLFFBQVEsRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkIsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFBO2dCQUMvQixNQUFNLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQTtnQkFDckIsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2hDLENBQUM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNO1FBQzNCLEtBQUssTUFBTSxDQUFBO1FBRVgsT0FBTyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFBO0lBQzNFLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCwwQkFBMEIsQ0FBQyxFQUFDLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBQztRQUN4RixJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsZ0JBQWdCLGtDQUFrQyxDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFBO1FBQy9DLE1BQU0sZUFBZSxHQUFHLGdCQUFnQixDQUFDLDJCQUEyQixDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFFdEYsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxnQkFBZ0IsQ0FBQyxJQUFJLDJDQUEyQyxnQkFBZ0IscUJBQXFCLGdCQUFnQixDQUFDLElBQUksZ0NBQWdDLGdCQUFnQixLQUFLLENBQUMsQ0FBQTtRQUMzTSxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMscUJBQXFCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUM3RSxNQUFNLGdCQUFnQixHQUFHLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUMvQyxNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsRUFBQyxDQUFDLENBQUE7UUFDOUcsTUFBTSxnQkFBZ0IsR0FBRyxXQUFXLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtRQUVwRSxJQUFJLGdCQUFnQixJQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3RELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELGdCQUFnQixvQkFBb0IsZ0JBQWdCLENBQUMsSUFBSSw4RUFBOEUsZ0JBQWdCLENBQUMsSUFBSSxnQ0FBZ0MsZ0JBQWdCLFVBQVUsQ0FBQyxDQUFBO1FBQzNSLENBQUM7UUFDRCxJQUFJLE9BQU8sZUFBZSxDQUFDLEtBQUssS0FBSyxRQUFRLElBQUksb0JBQW9CLENBQUMsTUFBTSxHQUFHLGVBQWUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNyRyxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0Isc0NBQXNDLGVBQWUsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFBO1FBQ3RILENBQUM7UUFDRCxJQUFJLGdCQUFnQixLQUFLLFNBQVMsSUFBSSxvQkFBb0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDdEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDRCQUE0QixnQkFBZ0IsaUJBQWlCLENBQUMsQ0FBQTtRQUNySCxDQUFDO1FBRUQsTUFBTSxnQkFBZ0IsR0FBRyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsQ0FBQTtRQUUzRCxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxnQkFBZ0IsUUFBUSxnQkFBZ0IsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZILENBQUM7UUFFRCxNQUFNLG1CQUFtQixHQUFHLFVBQVUsQ0FBQywrQ0FBK0MsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBRXhHLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELGdCQUFnQixDQUFDLFlBQVksRUFBRSx5QkFBeUIsZ0JBQWdCLElBQUksQ0FBQyxDQUFBO1FBQ3pKLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyxJQUFJLG1CQUFtQixDQUFDLGFBQWEsQ0FBQztZQUMxRCxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsVUFBVTtZQUNWLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxJQUFJLEVBQUU7WUFDM0IsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLElBQUksRUFBRTtZQUN6QixVQUFVLEVBQUUsZ0JBQWdCO1lBQzVCLFNBQVMsRUFBRSxtQkFBbUIsQ0FBQyxTQUFTO1lBQ3hDLE1BQU0sRUFBRSxVQUFVLENBQUMsbUJBQW1CLEVBQUU7WUFDeEMscUJBQXFCLEVBQUUsbUJBQW1CLENBQUMscUJBQXFCO1NBQ2pFLENBQUMsQ0FBQTtRQUNGLE1BQU0sdUJBQXVCLEdBQUcsV0FBVyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksS0FBSyxVQUFVLENBQUMsQ0FBQTtRQUM1RixNQUFNLE9BQU8sR0FBRyxvQkFBb0I7YUFDakMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsaUNBQWlDLENBQUMsRUFBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDLENBQUMsQ0FBQzthQUNoSCxNQUFNLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUNoQixJQUFJLE9BQU8sZUFBZSxDQUFDLFFBQVEsS0FBSyxVQUFVO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRS9ELE9BQU8sQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNGLENBQUMsQ0FBQyxDQUFBO1FBRUosT0FBTztZQUNMLE9BQU8sRUFBRSxVQUFVLENBQUMsY0FBYyxFQUFFLElBQUksSUFBSSxDQUFDLE9BQU87WUFDcEQsYUFBYTtZQUNiLG1CQUFtQjtZQUNuQix1QkFBdUI7WUFDdkIsZ0JBQWdCO1lBQ2hCLE9BQU87WUFDUCxZQUFZO1lBQ1osZ0JBQWdCO1NBQ2pCLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILDBCQUEwQixDQUFDLEVBQUMsVUFBVSxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDO1FBQ3pFLElBQUksZ0JBQWdCLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDL0IsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsZ0JBQWdCLGVBQWUsT0FBTyxVQUFVLEVBQUUsQ0FBQyxDQUFBO1lBQzdHLENBQUM7WUFFRCxPQUFPLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDOUIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDZCQUE2QixDQUFDLENBQUE7Z0JBRTlHLHdFQUF3RTtnQkFDeEUsT0FBTywrQ0FBK0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2hFLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELElBQUksVUFBVSxJQUFJLElBQUk7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUNqQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUM5QixPQUFPLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDOUIsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDZCQUE2QixDQUFDLENBQUE7Z0JBRTlHLHdFQUF3RTtnQkFDeEUsT0FBTywrQ0FBK0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ2hFLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUNELElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMvQixNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxnQkFBZ0IsZUFBZSxPQUFPLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFDOUcsQ0FBQztRQUVELHdFQUF3RTtRQUN4RSxPQUFPLENBQUMsK0NBQStDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsaUNBQWlDLENBQUMsRUFBQyxXQUFXLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDO1FBQ3hGLG9EQUFvRDtRQUNwRCxNQUFNLFVBQVUsR0FBRyxFQUFFLENBQUE7UUFDckIsb0RBQW9EO1FBQ3BELE1BQU0sV0FBVyxHQUFHLEVBQUUsQ0FBQTtRQUN0QixvREFBb0Q7UUFDcEQsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLENBQUE7UUFDM0IsK0NBQStDO1FBQy9DLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQTtRQUNyQixNQUFNLHFCQUFxQixHQUFHLGdCQUFnQixDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFbEUsS0FBSyxNQUFNLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUMzRCxJQUFJLGFBQWEsS0FBSyxJQUFJLEVBQUUsQ0FBQztnQkFDM0IsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7b0JBQzNELE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQix5Q0FBeUMsQ0FBQyxDQUFBO2dCQUNqRyxDQUFDO2dCQUVELFVBQVUsQ0FBQyxFQUFFLEdBQUcsS0FBSyxDQUFBO2dCQUNyQixTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksYUFBYSxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUNqQyxJQUFJLE9BQU8sS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUMvQixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0Isc0NBQXNDLENBQUMsQ0FBQTtnQkFDOUYsQ0FBQztnQkFFRCxVQUFVLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtnQkFDM0IsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLGFBQWEsS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDbkMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLHdDQUF3QyxDQUFDLENBQUE7Z0JBQ3pILE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFBO2dCQUNoQyxTQUFRO1lBQ1YsQ0FBQztZQUVELElBQUksYUFBYSxLQUFLLGFBQWEsRUFBRSxDQUFDO2dCQUNwQyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQztvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0IseUNBQXlDLENBQUMsQ0FBQTtnQkFDMUgsTUFBTSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUE7Z0JBQ2pDLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxhQUFhLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztnQkFDekMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsZ0JBQWdCLDhDQUE4QyxDQUFDLENBQUE7Z0JBQy9ILE1BQU0sQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLENBQUE7Z0JBQ3RDLFNBQVE7WUFDVixDQUFDO1lBRUQsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7Z0JBQ3pDLE1BQU0sc0JBQXNCLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBRTNFLElBQUksQ0FBQyxzQkFBc0I7b0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQ0FBa0MsYUFBYSxFQUFFLENBQUMsQ0FBQTtnQkFDL0YsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsc0JBQXNCLENBQUMsRUFBRSxDQUFDO29CQUNoRCxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixzQkFBc0IsOEJBQThCLGdCQUFnQixlQUFlLGFBQWEsaUNBQWlDLENBQUMsQ0FBQTtnQkFDOUssQ0FBQztnQkFFRCxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQyxHQUFHLEtBQUssQ0FBQTtnQkFDaEQsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQ3pDLFdBQVcsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUE7WUFDcEMsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLFVBQVUsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUE7WUFDbkMsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxVQUFVLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUMxRSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUM7WUFBRSxVQUFVLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQTtRQUM3RSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQTtRQUU1RixPQUFPLFVBQVUsQ0FBQTtJQUNuQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsVUFBVSxFQUFFLFlBQVksR0FBRyxJQUFJO1FBQzdGLE1BQU0sY0FBYyxHQUFHLFlBQVk7ZUFDOUIsb0JBQW9CLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUUzSCxLQUFLLE1BQU0sZ0JBQWdCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7WUFDN0QsTUFBTSxXQUFXLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1lBRTNELElBQUksQ0FBQyxXQUFXO2dCQUFFLFNBQVE7WUFFMUIsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLDBCQUEwQixDQUFDO2dCQUM5QyxXQUFXO2dCQUNYLFVBQVU7Z0JBQ1YsTUFBTTtnQkFDTixVQUFVLEVBQUUsZ0JBQWdCLENBQUMsZ0JBQWdCLENBQUM7Z0JBQzlDLGdCQUFnQjthQUNqQixDQUFDLENBQUE7WUFFRixJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsT0FBTyxFQUFFLEtBQUssV0FBVztnQkFBRSxTQUFRO1lBRTVELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFBO1lBRWxHLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNwQyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztvQkFDbkIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO3dCQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0Isd0ZBQXdGLENBQUMsQ0FBQTtvQkFDaEosQ0FBQztvQkFDRCxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFBO29CQUVuQixJQUFJLEVBQUUsSUFBSSxTQUFTO3dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQixxQ0FBcUMsQ0FBQyxDQUFBO29CQUVoSCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQzt3QkFDNUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO3dCQUN4QixNQUFNLEVBQUUsU0FBUzt3QkFDakIsMEJBQTBCLEVBQUUsT0FBTyxDQUFDLG1CQUFtQixDQUFDLHFCQUFxQjt3QkFDN0UsRUFBRTt3QkFDRixnQkFBZ0I7d0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7cUJBQzNDLENBQUMsQ0FBQTtvQkFFRixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFBO29CQUM3QyxNQUFNLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsQ0FBQTtvQkFDckMsU0FBUTtnQkFDVixDQUFDO2dCQUVELE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLENBQUE7Z0JBQ25CLE1BQU0sS0FBSyxHQUFHLEVBQUUsSUFBSSxTQUFTO29CQUMzQixDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQUM7d0JBQzdCLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTzt3QkFDeEIsTUFBTSxFQUFFLFFBQVE7d0JBQ2hCLDBCQUEwQixFQUFFLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxxQkFBcUI7d0JBQzdFLEVBQUU7d0JBQ0YsZ0JBQWdCO3dCQUNoQixnQkFBZ0IsRUFBRSxPQUFPLENBQUMsZ0JBQWdCO3FCQUMzQyxDQUFDO29CQUNGLENBQUMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO2dCQUVsQyxNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUM7b0JBQ3BELEtBQUs7b0JBQ0wsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLHVCQUF1QjtvQkFDeEQsS0FBSztpQkFDTixDQUFDLENBQUE7Z0JBQ0YsTUFBTSxPQUFPLENBQUMsYUFBYSxDQUFDLCtCQUErQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsZ0JBQWdCLElBQUksRUFBRSxFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQTtnQkFDekgsTUFBTSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUE7Z0JBRWxCLElBQUksRUFBRSxJQUFJLFNBQVMsRUFBRSxDQUFDO29CQUNwQixNQUFNLElBQUksQ0FBQyxzQkFBc0IsQ0FBQzt3QkFDaEMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO3dCQUN4QixLQUFLO3dCQUNMLDBCQUEwQixFQUFFLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxxQkFBcUI7d0JBQzdFLGdCQUFnQjt3QkFDaEIsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLGdCQUFnQjtxQkFDM0MsQ0FBQyxDQUFBO2dCQUNKLENBQUM7Z0JBRUQsSUFBSSxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztvQkFDM0IsTUFBTSxPQUFPLENBQUMsYUFBYSxDQUFDLHNCQUFzQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsVUFBVSxFQUFFLFdBQVcsQ0FBQyxDQUFBO2dCQUM1RyxDQUFDO2dCQUVELE1BQU0sQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1lBQzdDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7OztPQWlCRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsVUFBVSxFQUFFLFlBQVksR0FBRyxJQUFJO1FBQ3BGLE1BQU0sY0FBYyxHQUFHLFlBQVk7ZUFDOUIsb0JBQW9CLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUMsQ0FBQTtRQUUzSCxLQUFLLE1BQU0sZ0JBQWdCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7WUFDN0QsTUFBTSxXQUFXLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1lBRTNELElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsZ0JBQWdCLDBCQUEwQixJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksZ0NBQWdDLGdCQUFnQiw0Q0FBNEMsQ0FBQyxDQUFBO1lBQ3hNLENBQUM7WUFFRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsMEJBQTBCLENBQUM7Z0JBQzlDLFdBQVc7Z0JBQ1gsVUFBVTtnQkFDVixNQUFNO2dCQUNOLFVBQVUsRUFBRSxnQkFBZ0IsQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDOUMsZ0JBQWdCO2FBQ2pCLENBQUMsQ0FBQTtZQUVGLElBQUksT0FBTyxDQUFDLFlBQVksQ0FBQyxPQUFPLEVBQUUsS0FBSyxXQUFXO2dCQUFFLFNBQVE7WUFFNUQsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLENBQUMsbUNBQW1DLENBQUM7Z0JBQ3BFLE1BQU07Z0JBQ04sWUFBWSxFQUFFLE9BQU8sQ0FBQyxZQUFZO2dCQUNsQyxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsZ0JBQWdCO2FBQzNDLENBQUMsQ0FBQTtZQUVGLE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQTtZQUN6QixNQUFNLGFBQWEsR0FBRyxFQUFFLENBQUE7WUFDeEIsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFBO1lBRXhCLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNwQyxJQUFJLEtBQUssRUFBRSxRQUFRLEVBQUUsQ0FBQztvQkFDcEIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO3dCQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0Isd0ZBQXdGLENBQUMsQ0FBQTtvQkFDaEosQ0FBQztvQkFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsRUFBRSxDQUFDO3dCQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQixxQ0FBcUMsQ0FBQyxDQUFBO29CQUM3RixDQUFDO29CQUNELGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBQzVCLENBQUM7cUJBQU0sSUFBSSxLQUFLLEVBQUUsRUFBRSxFQUFFLENBQUM7b0JBQ3JCLGFBQWEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBQzNCLENBQUM7cUJBQU0sQ0FBQztvQkFDTixhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO2dCQUMzQixDQUFDO1lBQ0gsQ0FBQztZQUVELEtBQUssTUFBTSxLQUFLLElBQUksY0FBYyxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLENBQUE7Z0JBRW5CLElBQUksRUFBRSxJQUFJLFNBQVMsRUFBRSxDQUFDO29CQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixnQkFBZ0IscUNBQXFDLENBQUMsQ0FBQTtnQkFDN0YsQ0FBQztnQkFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztvQkFDM0MsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO29CQUN4QixNQUFNLEVBQUUsU0FBUztvQkFDakIsMEJBQTBCLEVBQUUsT0FBTyxDQUFDLG1CQUFtQixDQUFDLHFCQUFxQjtvQkFDN0UsRUFBRTtvQkFDRixNQUFNO29CQUNOLG9CQUFvQjtvQkFDcEIsZ0JBQWdCO29CQUNoQixnQkFBZ0IsRUFBRSxPQUFPLENBQUMsZ0JBQWdCO2lCQUMzQyxDQUFDLENBQUE7Z0JBRUYsTUFBTSxPQUFPLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUMvQyxDQUFDO1lBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLEVBQUUsQ0FBQTtnQkFFbkIsSUFBSSxFQUFFLElBQUksU0FBUyxFQUFFLENBQUM7b0JBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMscUJBQXFCLGdCQUFnQixtQ0FBbUMsQ0FBQyxDQUFBO2dCQUMzRixDQUFDO2dCQUVELE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDO29CQUMzQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87b0JBQ3hCLE1BQU0sRUFBRSxRQUFRO29CQUNoQiwwQkFBMEIsRUFBRSxPQUFPLENBQUMsbUJBQW1CLENBQUMscUJBQXFCO29CQUM3RSxFQUFFO29CQUNGLE1BQU07b0JBQ04sb0JBQW9CO29CQUNwQixnQkFBZ0I7b0JBQ2hCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0I7aUJBQzNDLENBQUMsQ0FBQTtnQkFFRixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUM7b0JBQ3BELEtBQUssRUFBRSxRQUFRO29CQUNmLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyx1QkFBdUI7b0JBQ3hELEtBQUs7aUJBQ04sQ0FBQyxDQUFBO2dCQUNGLE1BQU0sT0FBTyxDQUFDLGFBQWEsQ0FBQywrQkFBK0IsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLGdCQUFnQixJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBQzVILE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFBO2dCQUVyQixJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO29CQUMzQixNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsV0FBVyxDQUFDLENBQUE7Z0JBQy9HLENBQUM7WUFDSCxDQUFDO1lBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxLQUFLLEdBQUcsSUFBSSxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtnQkFFNUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO2dCQUNsQyxNQUFNLE9BQU8sQ0FBQyxhQUFhLENBQUMseUJBQXlCLENBQUM7b0JBQ3BELEtBQUs7b0JBQ0wsdUJBQXVCLEVBQUUsT0FBTyxDQUFDLHVCQUF1QjtvQkFDeEQsS0FBSztpQkFDTixDQUFDLENBQUE7Z0JBQ0YsTUFBTSxPQUFPLENBQUMsYUFBYSxDQUFDLCtCQUErQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsZ0JBQWdCLElBQUksRUFBRSxFQUFFLFVBQVUsRUFBRSxXQUFXLENBQUMsQ0FBQTtnQkFDekgsTUFBTSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUE7Z0JBRWxCLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixDQUFDO29CQUNoQyxPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87b0JBQ3hCLEtBQUs7b0JBQ0wsMEJBQTBCLEVBQUUsT0FBTyxDQUFDLG1CQUFtQixDQUFDLHFCQUFxQjtvQkFDN0UsZ0JBQWdCO29CQUNoQixnQkFBZ0IsRUFBRSxPQUFPLENBQUMsZ0JBQWdCO2lCQUMzQyxDQUFDLENBQUE7Z0JBRUYsSUFBSSxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztvQkFDM0IsTUFBTSxPQUFPLENBQUMsYUFBYSxDQUFDLHNCQUFzQixDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsVUFBVSxFQUFFLFdBQVcsQ0FBQyxDQUFBO2dCQUM1RyxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxFQUFDLEtBQUssRUFBRSx1QkFBdUIsRUFBRSxLQUFLLEVBQUM7UUFDckUsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ25DLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxDQUFDLENBQUE7WUFFMUcsTUFBTSxRQUFRLEdBQUcscUNBQXFDLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxhQUFhLEVBQUUsRUFBRSxLQUFLLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSx1QkFBdUIsQ0FBQyxDQUFBO1lBQ3JJLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixDQUFDLEtBQUssRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUN2RCxDQUFDO1FBRUQsSUFBSSxLQUFLLENBQUMsV0FBVyxLQUFLLFNBQVMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUN6RSxNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxDQUFDLENBQUE7UUFDdkUsQ0FBQztRQUVELElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFdBQVcsSUFBSSxJQUFJLEVBQUUsdUJBQXVCLENBQUMsQ0FBQTtJQUNwRixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCw0QkFBNEIsQ0FBQyxZQUFZLEVBQUUsVUFBVTtRQUNuRCxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsYUFBYSxFQUFFLENBQUE7UUFFL0MsT0FBTyxVQUFVLENBQUMsK0JBQStCLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLENBQUE7SUFDL0UsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxtQ0FBbUMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUUsZ0JBQWdCLEVBQUM7UUFDMUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ3BGLDhDQUE4QztRQUM5QyxNQUFNLFVBQVUsR0FBRyxFQUFDLENBQUMsVUFBVSxDQUFDLEVBQUUsOEJBQThCLENBQUMsQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLENBQUMsRUFBQyxDQUFBO1FBRS9FLElBQUksWUFBWSxDQUFDLGNBQWMsRUFBRSxFQUFFLENBQUM7WUFDbEMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGlDQUFpQyxDQUFDLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO1lBRTVGLFVBQVUsQ0FBQyxhQUFhLENBQUMsR0FBRyxNQUFNLENBQUMsYUFBYSxFQUFFLENBQUMsWUFBWSxFQUFFLENBQUE7UUFDbkUsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILGlDQUFpQyxDQUFDLFlBQVksRUFBRSxVQUFVO1FBQ3hELE1BQU0sVUFBVSxHQUFHLFlBQVksQ0FBQyx3QkFBd0IsRUFBRSxDQUFBO1FBRTFELE9BQU8sVUFBVSxDQUFDLCtCQUErQixFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksVUFBVSxDQUFBO0lBQy9FLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsS0FBSyxDQUFDLGlCQUFpQixDQUFDLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSwwQkFBMEIsRUFBRSxFQUFFLEVBQUUsZ0JBQWdCLEVBQUUsZ0JBQWdCLEVBQUM7UUFDM0csTUFBTSxVQUFVLEdBQUcsZ0JBQWdCLENBQUMsVUFBVSxFQUFFLENBQUE7UUFDaEQsTUFBTSxLQUFLLEdBQUcsT0FBTztZQUNuQixDQUFDLENBQUMsZ0JBQWdCLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQywwQkFBMEIsRUFBRSxNQUFNLENBQUMsRUFBRSxPQUFPLENBQUM7WUFDOUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUM5QixNQUFNLFFBQVEsR0FBRyxNQUFNLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2QsTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLE1BQU0sV0FBVyxnQkFBZ0IsT0FBTyxFQUFFLHdDQUF3QyxDQUFDLENBQUE7UUFDL0csQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILDBCQUEwQixDQUFDLDBCQUEwQixFQUFFLE1BQU07UUFDM0QsTUFBTSxTQUFTLEdBQUcsMEJBQTBCLEVBQUUsU0FBUyxDQUFBO1FBRXZELElBQUksQ0FBQyxTQUFTLElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUM1RSxNQUFNLElBQUksS0FBSyxDQUFDLCtFQUErRSxNQUFNLEdBQUcsQ0FBQyxDQUFBO1FBQzNHLENBQUM7UUFFRCxNQUFNLGFBQWEsR0FBRyxxQ0FBcUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRS9FLElBQUksT0FBTyxhQUFhLEtBQUssUUFBUSxJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDbEUsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsTUFBTSxHQUFHLENBQUMsQ0FBQTtRQUMzRSxDQUFDO1FBRUQsT0FBTyxhQUFhLENBQUE7SUFDdEIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7O09BZ0JHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSwwQkFBMEIsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixFQUFFLGdCQUFnQixFQUFFLGdCQUFnQixFQUFDO1FBQ3hJLE1BQU0sVUFBVSxHQUFHLGdCQUFnQixDQUFDLFVBQVUsRUFBRSxDQUFBO1FBQ2hELE1BQU0sTUFBTSxHQUFHLEVBQUMsQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFLEVBQUUsR0FBRyxvQkFBb0IsRUFBQyxDQUFBO1FBQzFELE1BQU0sS0FBSyxHQUFHLE9BQU87WUFDbkIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsMEJBQTBCLEVBQUUsTUFBTSxDQUFDLEVBQUUsT0FBTyxDQUFDO1lBQzlHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFOUIsTUFBTSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTNDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxNQUFNLFdBQVcsZ0JBQWdCLE9BQU8sRUFBRSxrREFBa0QsTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFDLElBQUksT0FBTyxNQUFNLENBQUMsRUFBRSxFQUFFLDBCQUEwQixDQUFDLENBQUE7UUFDaE0sQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFBO0lBQ2pCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7T0FXRztJQUNILEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsMEJBQTBCLEVBQUUsZ0JBQWdCLEVBQUUsZ0JBQWdCLEVBQUM7UUFDM0csSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFNO1FBRXBCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQywwQkFBMEIsQ0FBQywwQkFBMEIsRUFBRSxRQUFRLENBQUMsQ0FBQTtRQUMzRixNQUFNLFVBQVUsR0FBRyxnQkFBZ0IsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUNoRCxNQUFNLGFBQWEsR0FBRyxNQUFNLGdCQUFnQjthQUN6QyxhQUFhLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQzthQUNyQyxLQUFLLENBQUMsRUFBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLEVBQUMsQ0FBQzthQUN0RCxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFcEIsSUFBSSxhQUFhLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sSUFBSSxLQUFLLENBQUMsb0JBQW9CLGdCQUFnQixJQUFJLGdCQUFnQixDQUFDLElBQUksbUJBQW1CLENBQUMsQ0FBQTtRQUNuRyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsbUNBQW1DLENBQUMsS0FBSyxFQUFFLE1BQU07UUFDckQsTUFBTSxpQkFBaUIsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUVwRCxJQUFJLGlCQUFpQixDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTTtRQUUxQyxLQUFLLE1BQU0sZ0JBQWdCLElBQUksaUJBQWlCLEVBQUUsQ0FBQztZQUNqRCxNQUFNLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ2hELENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBQ0gsU0FBUyxvQkFBb0IsQ0FBQyxVQUFVO0lBQ3RDLHVCQUF1QjtJQUN2QixNQUFNLFVBQVUsR0FBRyxFQUFFLENBQUE7SUFDckIsNEdBQTRHO0lBQzVHLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtJQUVqQixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUM7UUFBRSxPQUFPLEVBQUMsVUFBVSxFQUFFLE1BQU0sRUFBQyxDQUFBO0lBRTNELEtBQUssTUFBTSxLQUFLLElBQUksVUFBVSxFQUFFLENBQUM7UUFDL0IsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM5QixVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3hCLENBQUM7YUFBTSxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDdkUsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDakQsSUFBSSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztvQkFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQywwRkFBMEYsR0FBRyxZQUFZLEdBQUcsc0JBQXNCLENBQUMsQ0FBQTtnQkFDckosQ0FBQztnQkFDRCxNQUFNLGdCQUFnQixHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUUzRCxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztvQkFDdEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxrRUFBa0UsR0FBRyxJQUFJLENBQUMsQ0FBQTtnQkFDNUYsQ0FBQztnQkFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxHQUFHLHNDQUFzQyxPQUFPLEtBQUssR0FBRyxDQUFDLENBQUE7Z0JBQ2pILENBQUM7Z0JBRUQsTUFBTSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUE7WUFDeEQsQ0FBQztRQUNILENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxtRkFBbUYsT0FBTyxLQUFLLEdBQUcsQ0FBQyxDQUFBO1FBQ3JILENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxFQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUMsQ0FBQTtBQUM3QixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLHVCQUF1QixDQUFDLFFBQVEsRUFBRSxVQUFVO0lBQ25ELElBQUksU0FBUyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUE7SUFFL0MsT0FBTyxTQUFTLEVBQUUsQ0FBQztRQUNqQixJQUFJLE1BQU0sQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsVUFBVSxDQUFDO1lBQUUsT0FBTyxTQUFTLENBQUE7UUFFakYsU0FBUyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDOUMsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUyxxQ0FBcUMsQ0FDNUMsUUFBUSxFQUNSLGFBQWEsRUFDYixVQUFVLEVBQ1YsUUFBUSxHQUFHLCtDQUErQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQ2pFLHVCQUF1QixHQUFHLElBQUk7SUFFOUIseUZBQXlGO0lBQ3pGLHFGQUFxRjtJQUNyRiw0REFBNEQ7SUFDNUQsTUFBTSxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFDN0IsdUJBQXVCO0lBQ3ZCLE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFBO0lBQzVCLHVCQUF1QjtJQUN2QixNQUFNLHNCQUFzQixHQUFHLEVBQUUsQ0FBQTtJQUVqQyxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtJQUNsRyx1QkFBdUI7SUFDdkIsSUFBSSxvQkFBb0IsR0FBRyxFQUFFLENBQUE7SUFFN0IsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUNiLE1BQU0sYUFBYSxHQUFHLCtDQUErQyxDQUFDLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFBO1FBRTVGLG9CQUFvQixHQUFHLGFBQWEsQ0FBQywwQkFBMEIsRUFBRSxJQUFJLEVBQUUsQ0FBQTtJQUN6RSxDQUFDO0lBRUQsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLENBQUMsb0JBQW9CLENBQUMsQ0FBQTtJQUVuRCxLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ2hFLElBQUksU0FBUyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQy9DLHNCQUFzQixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtZQUMxQyxTQUFRO1FBQ1YsQ0FBQztRQUVELE1BQU0scUJBQXFCLEdBQUcsYUFBYSxDQUFDLG9CQUFvQixDQUFDLGFBQWEsQ0FBQyxJQUFJLGFBQWEsQ0FBQTtRQUNoRyxNQUFNLG1CQUFtQixHQUFHLE1BQU0sVUFBVSxDQUFDLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLENBQUE7UUFDOUUsTUFBTSxVQUFVLEdBQUcsYUFBYSxDQUFDLHlCQUF5QixDQUFDLFFBQVEsRUFBRSxtQkFBbUIsQ0FBQyxJQUFJLG1CQUFtQixDQUFBO1FBQ2hILE1BQU0sa0JBQWtCLEdBQUcsTUFBTSxVQUFVLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUE7UUFDOUUsTUFBTSxjQUFjLEdBQUcsUUFBUSxFQUFFLGNBQWMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFBO1FBRW5FLElBQUksVUFBVSxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQzNCLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMzQyxDQUFDO2FBQU0sSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUMxQixrQkFBa0IsQ0FBQyxhQUFhLENBQUMsR0FBRyxLQUFLLENBQUE7UUFDM0MsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQzVDLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssQ0FBQTtRQUMzQyxDQUFDO2FBQU0sQ0FBQztZQUNOLGlCQUFpQixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQTtRQUN2QyxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksc0JBQXNCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3RDLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyx1RUFBdUUsc0JBQXNCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO0lBQ2pMLENBQUM7SUFFRCxJQUFJLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsNENBQTRDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEVBQUMsSUFBSSxFQUFFLGdDQUFnQyxFQUFDLENBQUMsQ0FBQTtJQUNqSixDQUFDO0lBRUQsT0FBTyxrQkFBa0IsQ0FBQTtBQUMzQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIGZyb20gXCIuLi9hdXRob3JpemF0aW9uL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBCdWlsdC1pbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBhY3Rpb24uXG4gKiBAdHlwZWRlZiB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvblxuICovXG5cbi8qKlxuICogRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBtZXRob2RzIHVzZWQgYnkgcmVzb3VyY2VzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdCAmIHtcbiAqICAgY3VycmVudEFiaWxpdHk6ICgpID0+IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uOiAoYXJnczoge3BhZ2luYXRpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24sIHF1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTZWFyY2g6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc2VhcmNoOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2h9KSA9PiB2b2lkLFxuICogICBhcHBseUZyb250ZW5kTW9kZWxTb3J0OiAoYXJnczoge3F1ZXJ5OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sIHNvcnQ6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnR9KSA9PiB2b2lkLFxuICogICBmcm9udGVuZE1vZGVsQWJpbGl0eUFjdGlvbjogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBzdHJpbmcsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeTogKGFjdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD4sXG4gKiAgIGZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5OiAob3B0aW9ucz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zICYge3Jlc291cmNlPzogRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbFBhcmFtczogKCkgPT4gaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXMsXG4gKiAgIGZyb250ZW5kTW9kZWxQcmVsb2FkOiAoKSA9PiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbCxcbiAqICAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3M6IChtb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGwsXG4gKiAgIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWw6IChtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgb2JqZWN0IHwgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+PlxuICogfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlclxuICovXG5cbi8qKlxuICogR2VuZXJpYyBmcm9udGVuZC1tb2RlbCBpbmRleCBxdWVyeSBwYXNzZWQgdG8gcmVzb3VyY2UgcXVlcnkgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBbnlRdWVyeVxuICovXG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYnVpbGRpbmcgYSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBpbmRleCBxdWVyeS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3NcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gY29udHJvbGxlciAtIEZyb250ZW5kLW1vZGVsIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gKG9yIHJhdyBpbnB1dCBzaGFwZSBkdXJpbmcgZWFybHkgYm9vdHN0cmFwKS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VBYmlsaXR5QXJnc1xuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZSB3aGVuIHRoZSByZXNvdXJjZSBpcyB1c2VkIGRpcmVjdGx5IGZvciBhdXRob3JpemF0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtjb25maWd1cmF0aW9uXSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyLWxlc3MgY29uc3RydWN0aW9uIChmb3IgZXhhbXBsZSB0aGUgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCk7IHRoZSBjb250cm9sbGVyIHBhdGggZGVyaXZlcyBpdCBmcm9tIHRoZSBjb250cm9sbGVyIGluc3RlYWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzTG9vc2VPYmplY3R9IFtjb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2xvY2Fsc10gLSBBYmlsaXR5IGxvY2Fscy5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbbW9kZWxDbGFzc10gLSBPcHRpb25hbCBiYWNraW5nIG1vZGVsIGNsYXNzIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFttb2RlbE5hbWVdIC0gT3B0aW9uYWwgbW9kZWwgbmFtZSBvdmVycmlkZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IFtwYXJhbXNdIC0gT3B0aW9uYWwgcGFyYW1zIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBbcmVzb3VyY2VDb25maWd1cmF0aW9uXSAtIE9wdGlvbmFsIG5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAqL1xuXG4vKipcbiAqIE5vcm1hbGl6ZWQgc3luYyByZXBsYXkgbXV0YXRpb24gcGFzc2VkIHRvIHRoZSByZXNvdXJjZSBzeW5jIGhvb2tzLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL3N5bmMvc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IEZyb250ZW5kTW9kZWxTeW5jTXV0YXRpb25cbiAqL1xuXG4vKipcbiAqIFN5bmMgbXV0YXRpb24gYXV0aG9yaXphdGlvbiByZXN1bHQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb25cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gYWxsb3dlZCAtIFdoZXRoZXIgdGhlIG11dGF0aW9uIG1heSBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtyZWFzb25dIC0gU3RhYmxlIGZhaWx1cmUgcmVhc29uIGNvZGUgd2hlbiBkZW5pZWQuXG4gKi9cblxuLyoqXG4gKiBBcmd1bWVudHMgZm9yIHRoZSBhcHBseVN5bmMgZnVsbC1lc2NhcGUtaGF0Y2ggaG9vay5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxBcHBseVN5bmNBcmdzXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGV4aXN0aW5nU3luYyAtIEV4aXN0aW5nIHN5bmMgcm93IG9yIG51bGwuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IG11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gKi9cblxuLyoqXG4gKiBBcHBseSByZXN1bHQgcHJvZHVjZWQgYnkgcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNyZWF0ZWQgLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGVsZXRlZF0gLSBXaGV0aGVyIGEgcmVjb3JkIHdhcyBkZWxldGVkLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IHJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gKi9cblxuLyoqXG4gKiBSZXNvbHZlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSByZWdpc3RyYXRpb24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IG93bmluZyB0aGUgcmVzb3VyY2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSZXNvdXJjZSBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogVHJhbnNwb3J0LXNhZmUgdmFsdWUgYWNjZXB0ZWQgaW4gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb24gcGF5bG9hZHMuXG4gKiBOZXN0ZWQgb2JqZWN0L2FycmF5IHZhbHVlcyBhcmUgaW50ZW50aW9uYWxseSBvcGFxdWUgYmVjYXVzZSBUeXBlU2NyaXB0IHJlamVjdHNcbiAqIHJlY3Vyc2l2ZSBKU0RvYyB0eXBlZGVmcyBmb3IgdGhpcyB0cmFuc3BvcnQgcGF5bG9hZCBjb250cmFjdC5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUgfCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgQXJyYXk8dW5rbm93bj59IEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZVxuICovXG5cbi8qKlxuICogQXR0cmlidXRlIHBheWxvYWQgYWNjZXB0ZWQgYnkgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge1JlY29yZDxzdHJpbmcsIEZyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZT59IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWRcbiAqL1xuXG4vKipcbiAqIFZpcnR1YWwgc2V0dGVyIG1ldGhvZCBvbiBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlLlxuICogQHR5cGVkZWYgeyhhcmcxOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgYXJnMjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlKSA9PiAodm9pZCB8IFByb21pc2U8dm9pZD4pfSBGcm9udGVuZE1vZGVsUmVzb3VyY2VWaXJ0dWFsU2V0dGVyXG4gKi9cblxuLyoqXG4gKiBTdGF0aWMgaGVscGVycyB1c2VkIHdoZW4gY2hlY2tpbmcgd2hldGhlciBhIG1vZGVsLWxpa2UgcmVjZWl2ZXIgYWNjZXB0cyBhbiBhdHRyaWJ1dGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3NcbiAqIEBwcm9wZXJ0eSB7KGFyZzogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSByZXNvbHZlQXR0cmlidXRlTmFtZSAtIFJlc29sdmVzIGFsaWFzZXMgdG8gY2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZzE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXJnMjogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsfSBmaW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlIC0gTG9jYXRlcyBhIHNldHRlciBtZXRob2Qgb24gdGhlIHJlY2VpdmVyLlxuICovXG5cbi8qKlxuICogT3B0aW9ucyBwYXNzZWQgd2hpbGUgc2F2aW5nIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIG11dGF0aW9ucy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbYXR0YWNobWVudHNdIC0gVXBsb2FkZWQgYXR0YWNobWVudCBhdHRyaWJ1dGVzLlxuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbH0gW2NvbnRyb2xsZXJdIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgbXV0YXRpb24uXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBudWxsfSBbbmVzdGVkQXR0cmlidXRlc10gLSBOZXN0ZWQgYXR0cmlidXRlcyBwYXlsb2FkLlxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBuZXN0ZWQgYXR0cmlidXRlcyBlbnRyeS5cbiAqIEB0eXBlZGVmIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkICYge2lkPzogc3RyaW5nIHwgbnVtYmVyLCBfZGVzdHJveT86IGJvb2xlYW4sIGF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBhdHRhY2htZW50cz86IEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQsIG5lc3RlZEF0dHJpYnV0ZXM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfX0gRnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnlcbiAqL1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGJhY2tlbmQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFtUTW9kZWxDbGFzcz10eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRdXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZXh0ZW5kcyBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHtcbiAgLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBNb2RlbENsYXNzID0gdW5kZWZpbmVkXG5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGFiaWxpdGllcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGF0dGFjaG1lbnRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBjb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29sbGVjdGlvbkNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBtZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyByZWxhdGlvbnNoaXBzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHNlcnZlciA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luYyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgc3RhdGljIFNoYXJlZFJlc291cmNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlY2xhcmF0aXZlIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCAoY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lcylcbiAgICogdXNlZCBhcyB0aGUgZGVmYXVsdCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNwZXJtaXR0ZWRQYXJhbXN9IGFuZFxuICAgKiBhcyB0aGUgcm91dGVkIHN5bmMgcmVwbGF5IHBlcm1pdC4gUmVzb2x2ZWQgdGhyb3VnaCB0aGUgc2hhcmVkIHJlc291cmNlXG4gICAqIGxpa2UgdGhlIG90aGVyIHN0YXRpYyByZXNvdXJjZSBjb25maWc6IGFuIHVuZGVjbGFyZWQgZW52aXJvbm1lbnQgbGlzdFxuICAgKiBmYWxscyBiYWNrIHRvIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LCB3aGlsZSBhbiBleHBsaWNpdCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucy5cbiAgICogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHdyaXRhYmxlQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHwgRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3N9IGFyZ3MgLSBSZXNvdXJjZSBhcmdzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIHN1cGVyKHtcbiAgICAgIGFiaWxpdHk6IFwiYWJpbGl0eVwiIGluIGFyZ3MgPyBhcmdzLmFiaWxpdHkgOiB1bmRlZmluZWQsXG4gICAgICBjb250ZXh0OiBcImNvbnRleHRcIiBpbiBhcmdzID8gYXJncy5jb250ZXh0IHx8IHt9IDoge30sXG4gICAgICBsb2NhbHM6IFwibG9jYWxzXCIgaW4gYXJncyA/IGFyZ3MubG9jYWxzIHx8IHt9IDoge31cbiAgICB9KVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBcImNvbnRyb2xsZXJcIiBpbiBhcmdzID8gYXJncy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgdGhpcy5jb25maWd1cmF0aW9uVmFsdWUgPSBcImNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5jb25maWd1cmF0aW9uIDogdW5kZWZpbmVkXG4gICAgdGhpcy5tb2RlbENsYXNzVmFsdWUgPSBcIm1vZGVsQ2xhc3NcIiBpbiBhcmdzID8gYXJncy5tb2RlbENsYXNzIDogUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICB0aGlzLm1vZGVsTmFtZVZhbHVlID0gXCJtb2RlbE5hbWVcIiBpbiBhcmdzID8gYXJncy5tb2RlbE5hbWUgOiB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIHRoaXMucGFyYW1zVmFsdWUgPSBcInBhcmFtc1wiIGluIGFyZ3MgPyBhcmdzLnBhcmFtcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUgPSBcInJlc291cmNlQ29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLnJlc291cmNlQ29uZmlndXJhdGlvbiA6IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29uZmlndXJlZCBzaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgc2hhcmVkUmVzb3VyY2VDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5TaGFyZWRSZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgc3RhdGljIHJlc291cmNlIGNvbmZpZyB2YWx1ZSBmcm9tIHRoZSBlbnZpcm9ubWVudCByZXNvdXJjZSBmaXJzdCxcbiAgICogdGhlbiBmcm9tIHRoZSBzaGFyZWQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7XCJhYmlsaXRpZXNcIiB8IFwiYXR0YWNobWVudHNcIiB8IFwiYXR0cmlidXRlc1wiIHwgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIgfCBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiIHwgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiY29tbWFuZHNcIiB8IFwibWVtYmVyQ29tbWFuZHNcIiB8IFwibW9kZWxOYW1lXCIgfCBcInByaW1hcnlLZXlcIiB8IFwicmVsYXRpb25zaGlwc1wiIHwgXCJzZXJ2ZXJcIiB8IFwic3luY1wiIHwgXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiIHwgXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIn0gbmFtZSAtIFN0YXRpYyBjb25maWcgcHJvcGVydHkgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJlc29sdmVkIGNvbmZpZyB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKG5hbWUpIHtcbiAgICBpZiAodGhpc1tuYW1lXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpc1tuYW1lXVxuXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgaWYgKFNoYXJlZFJlc291cmNlW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiBTaGFyZWRSZXNvdXJjZVtuYW1lXVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRyYW5zbGF0ZWQgYXR0cmlidXRlcyBmcm9tIGVudmlyb25tZW50IGFuZCBzaGFyZWQgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9IC0gVHJhbnNsYXRlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBmcm9udGVuZC1zYWZlIGF0dGFjaG1lbnQgZGVjbGFyYXRpb25zIGZyb20gdGhlIGJhY2tpbmcgbW9kZWwuXG4gICAqIFJlc291cmNlLWxldmVsIGRlY2xhcmF0aW9ucyByZW1haW4gYXMgYSBmYWxsYmFjayBmb3IgZnJvbnRlbmQtb25seSByZXNvdXJjZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQ2xpZW50IGF0dGFjaG1lbnQgY29uZmlndXJhdGlvbiBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGF0dGFjaG1lbnRDb25maWd1cmF0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmVkQXR0YWNobWVudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPiB8IHVuZGVmaW5lZH0gKi8gKHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImF0dGFjaG1lbnRzXCIpKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gY29uZmlndXJlZEF0dGFjaG1lbnRzID8gey4uLmNvbmZpZ3VyZWRBdHRhY2htZW50c30gOiB7fVxuXG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHJldHVybiBhdHRhY2htZW50c1xuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIGRlZmluaXRpb25dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuTW9kZWxDbGFzcy5nZXRBdHRhY2htZW50c01hcCgpKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudENvbmZpZyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0YWNobWVudENvbmZpZ3VyYXRpb259ICovICh7dHlwZTogZGVmaW5pdGlvbi50eXBlfSlcblxuICAgICAgaWYgKGRlZmluaXRpb24uc3luYykgYXR0YWNobWVudENvbmZpZy5zeW5jID0gey4uLmRlZmluaXRpb24uc3luY31cblxuICAgICAgYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gYXR0YWNobWVudENvbmZpZ1xuICAgIH1cblxuICAgIHJldHVybiBhdHRhY2htZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHJlc291cmNlIGluc3RhbmNlIGZvciBzaGFyZWQtcmVzb3VyY2UgZmFsbGJhY2sgY2FsbHMuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgbnVsbH0gLSBTaGFyZWQgcmVzb3VyY2UgaW5zdGFuY2Ugd2hlbiBjb25maWd1cmVkLlxuICAgKi9cbiAgc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpIHtcbiAgICBpZiAodGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG5cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgdW5kZWZpbmVkfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSB7XG4gICAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IG51bGxcbiAgICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuICAgIH1cblxuICAgIGlmIChTaGFyZWRSZXNvdXJjZSA9PT0gUmVzb3VyY2VDbGFzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke1Jlc291cmNlQ2xhc3MubmFtZX0uU2hhcmVkUmVzb3VyY2UgY2Fubm90IHBvaW50IHRvIGl0c2VsZi5gKVxuICAgIH1cblxuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gbmV3IFNoYXJlZFJlc291cmNlKHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMuY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLm1vZGVsQ2xhc3MoKSxcbiAgICAgIG1vZGVsTmFtZTogdGhpcy5tb2RlbE5hbWUoKSxcbiAgICAgIHBhcmFtczogdGhpcy5wYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxscyBhIHNoYXJlZC1yZXNvdXJjZSBtZXRob2Qgb25seSB3aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ugb3ZlcnJpZGVzIHRoZSBmcmFtZXdvcmsgZGVmYXVsdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIE1ldGhvZCBhcmdzLlxuICAgKiBAcmV0dXJucyB7e2NhbGxlZDogYm9vbGVhbiwgcmVzdWx0OiB1bmtub3dufX0gLSBTaGFyZWQgbWV0aG9kIGNhbGwgcmVzdWx0LlxuICAgKi9cbiAgY2FsbFNoYXJlZFJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUsIGFyZ3MpIHtcbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoIXNoYXJlZFJlc291cmNlKSByZXR1cm4ge2NhbGxlZDogZmFsc2UsIHJlc3VsdDogdW5kZWZpbmVkfVxuXG4gICAgY29uc3QgbWV0aG9kT3duZXIgPSBwcm90b3R5cGVPd25lckZvck1ldGhvZChzaGFyZWRSZXNvdXJjZSwgbWV0aG9kTmFtZSlcblxuICAgIGlmICghbWV0aG9kT3duZXIgfHwgbWV0aG9kT3duZXIgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlIHx8IG1ldGhvZE93bmVyID09PSBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlLnByb3RvdHlwZSkge1xuICAgICAgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc2hhcmVkUmVzb3VyY2UpKVttZXRob2ROYW1lXVxuXG4gICAgcmV0dXJuIHtjYWxsZWQ6IHRydWUsIHJlc3VsdDogbWV0aG9kLmFwcGx5KHNoYXJlZFJlc291cmNlLCBhcmdzKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNoYXJlZCBtZXRob2QgcmVzdWx0IG9yIGEgZmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBTaGFyZWQgbWV0aG9kIG5hbWUuXG4gICAqIEBwYXJhbSB7dW5rbm93bltdfSBhcmdzIC0gU2hhcmVkIG1ldGhvZCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFJlc3VsdH0gZmFsbGJhY2sgLSBGYWxsYmFjayBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Jlc3VsdH0gLSBTaGFyZWQgb3IgZmFsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgc2hhcmVkUmVzb3VyY2VNZXRob2RPcihtZXRob2ROYW1lLCBhcmdzLCBmYWxsYmFjaykge1xuICAgIGNvbnN0IHNoYXJlZFJlc3VsdCA9IHRoaXMuY2FsbFNoYXJlZFJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUsIGFyZ3MpXG5cbiAgICBpZiAoc2hhcmVkUmVzdWx0LmNhbGxlZCkgcmV0dXJuIC8qKiBAdHlwZSB7UmVzdWx0fSAqLyAoc2hhcmVkUmVzdWx0LnJlc3VsdClcblxuICAgIHJldHVybiBmYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBtZXRob2Qgb24gdGhpcyByZXNvdXJjZSBvciBpdHMgc2hhcmVkIGZhbGxiYWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0aG9kTmFtZSAtIE1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e21ldGhvZDogKC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93biwgcmVzb3VyY2U6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9IHwgbnVsbH0gLSBSZXNvbHZlZCBtZXRob2QgYW5kIHJlY2VpdmVyLlxuICAgKi9cbiAgcmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSkge1xuICAgIGNvbnN0IG93bk1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh0aGlzKSlbbWV0aG9kTmFtZV1cblxuICAgIGlmICh0eXBlb2Ygb3duTWV0aG9kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAob3duTWV0aG9kKSxcbiAgICAgICAgcmVzb3VyY2U6IHRoaXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBzaGFyZWRSZXNvdXJjZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoIXNoYXJlZFJlc291cmNlKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc2hhcmVkTWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIGlmICh0eXBlb2Ygc2hhcmVkTWV0aG9kICE9PSBcImZ1bmN0aW9uXCIpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgbWV0aG9kOiAvKiogQHR5cGUgeyguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd259ICovIChzaGFyZWRNZXRob2QpLFxuICAgICAgcmVzb3VyY2U6IHNoYXJlZFJlc291cmNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWJpbGl0aWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhYmlsaXRpZXMoKSB7XG4gICAgdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWJpbGl0aWVzXCIsIFtdLCAoKSA9PiB1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0eXBlZCBjb250cm9sbGVyIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gLSBDb250cm9sbGVyIGluc3RhbmNlIHdpdGggZnJvbnRlbmQtbW9kZWwgaGVscGVycy5cbiAgICovXG4gIHR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9ICovICh0aGlzLmNvbnRyb2xsZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IC0gU3RhdGljIHJlc291cmNlIGNvbmZpZyAocmF3IHVzZXIgaW5wdXQgc2hhcGU7IGNvbnN1bWVycyBub3JtYWxpemUpLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQ29uZmlnKCkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJhdHRyaWJ1dGVzXCIpXG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYWJpbGl0aWVzXCIpXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB0aGlzLmF0dGFjaG1lbnRDb25maWd1cmF0aW9ucygpXG4gICAgY29uc3QgY29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJjb21tYW5kc1wiKVxuICAgIGNvbnN0IGJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIpXG4gICAgY29uc3QgYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYnVpbHRJbk1lbWJlckNvbW1hbmRzXCIpXG4gICAgY29uc3QgY29sbGVjdGlvbkNvbW1hbmRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiY29sbGVjdGlvbkNvbW1hbmRzXCIpXG4gICAgY29uc3QgbWVtYmVyQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJtZW1iZXJDb21tYW5kc1wiKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1vZGVsTmFtZVwiKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJwcmltYXJ5S2V5XCIpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInJlbGF0aW9uc2hpcHNcIilcbiAgICBjb25zdCBzZXJ2ZXIgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzZXJ2ZXJcIilcbiAgICBjb25zdCBzeW5jID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwic3luY1wiKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAqL1xuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW119ICovIChhdHRyaWJ1dGVzIHx8IFtdKVxuICAgIH1cblxuICAgIGlmIChhYmlsaXRpZXMpIGNvbmZpZy5hYmlsaXRpZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYWJpbGl0aWVzKVxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgY29uZmlnLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoY29tbWFuZHMpIGNvbmZpZy5jb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChjb21tYW5kcylcbiAgICBpZiAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcykgY29uZmlnLmJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKSBjb25maWcuYnVpbHRJbk1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGJ1aWx0SW5NZW1iZXJDb21tYW5kcylcbiAgICBpZiAoY29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuY29sbGVjdGlvbkNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbGxlY3Rpb25Db21tYW5kcylcbiAgICBpZiAobWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5tZW1iZXJDb21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChtZW1iZXJDb21tYW5kcylcbiAgICBpZiAobW9kZWxOYW1lKSBjb25maWcubW9kZWxOYW1lID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChtb2RlbE5hbWUpXG4gICAgaWYgKHByaW1hcnlLZXkpIGNvbmZpZy5wcmltYXJ5S2V5ID0gLyoqIEB0eXBlIHtzdHJpbmd9ICovIChwcmltYXJ5S2V5KVxuICAgIGlmIChyZWxhdGlvbnNoaXBzKSBjb25maWcucmVsYXRpb25zaGlwcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChyZWxhdGlvbnNoaXBzKVxuICAgIGlmIChzZXJ2ZXIpIGNvbmZpZy5zZXJ2ZXIgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbn0gKi8gKHNlcnZlcilcbiAgICBpZiAoc3luYyAhPT0gdW5kZWZpbmVkKSBjb25maWcuc3luYyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbiB8IGJvb2xlYW59ICovIChzeW5jKVxuXG4gICAgcmV0dXJuIGNvbmZpZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RhdGljIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgbW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMuTW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gcmVxdWlyZXMgYSBzdGF0aWMgTW9kZWxDbGFzcy5gKVxuXG4gICAgcmV0dXJuIHRoaXMuTW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbnRyb2xsZXIuanNcIikuZGVmYXVsdH0gLSBDb250cm9sbGVyIGluc3RhbmNlLlxuICAgKi9cbiAgY29udHJvbGxlckluc3RhbmNlKCkge1xuICAgIGlmICghdGhpcy5jb250cm9sbGVyKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcblxuICAgIHJldHVybiB0aGlzLmNvbnRyb2xsZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbjogdGhlIGNvbnRyb2xsZXIncyB3aGVuIHRoZSByZXNvdXJjZVxuICAgKiBzZXJ2ZXMgYSBjb250cm9sbGVyIHJlcXVlc3QsIG90aGVyd2lzZSB0aGUgY29uc3RydWN0b3ItaW5qZWN0ZWRcbiAgICogY29uZmlndXJhdGlvbiAoZm9yIGV4YW1wbGUgYSBzeW5jIHdlYnNvY2tldCBjaGFubmVsJ3MgcmVzb3VyY2UpLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFZlbG9jaW91cyBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgY29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250cm9sbGVyKSByZXR1cm4gdGhpcy5jb250cm9sbGVySW5zdGFuY2UoKS5nZXRDb25maWd1cmF0aW9uKClcbiAgICBpZiAodGhpcy5jb25maWd1cmF0aW9uVmFsdWUpIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25WYWx1ZVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIG9yIGFuIGluamVjdGVkIGNvbmZpZ3VyYXRpb24uYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7VE1vZGVsQ2xhc3N9IC0gTW9kZWwgY2xhc3MuXG4gICAqL1xuICBtb2RlbENsYXNzKCkge1xuICAgIGlmICghdGhpcy5tb2RlbENsYXNzVmFsdWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgbW9kZWwgY2xhc3MuYClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtUTW9kZWxDbGFzc30gKi8gKHRoaXMubW9kZWxDbGFzc1ZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZWQgbW9kZWwgY2xhc3MgZm9yIGF1dGhvcml6YXRpb24gaGVscGVycy5cbiAgICogQHJldHVybnMge1RNb2RlbENsYXNzfSAtIEJhY2tpbmcgbW9kZWwgY2xhc3MuXG4gICAqL1xuICByZXF1aXJlZE1vZGVsQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1vZGVsIG5hbWUuXG4gICAqL1xuICBtb2RlbE5hbWUoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsTmFtZVZhbHVlKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIG1vZGVsIG5hbWUuYClcblxuICAgIHJldHVybiB0aGlzLm1vZGVsTmFtZVZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gLSBQYXJhbXMuXG4gICAqL1xuICBwYXJhbXMoKSB7IHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVmVsb2Npb3VzUGFyYW1zfSAqLyAodGhpcy5wYXJhbXNWYWx1ZSB8fCBzdXBlci5wYXJhbXMoKSB8fCB7fSkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIFJlc291cmNlIGNvbmZpZyAobm9ybWFsaXplZCBhdCBydW50aW1lOyByYXcgZHVyaW5nIGVhcmx5IGJvb3RzdHJhcCkuXG4gICAqL1xuICByZXNvdXJjZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uYClcblxuICAgIHJldHVybiB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIFJhaWxzLXN0cm9uZy1wYXJhbXMgLyBhcGlfbWFrZXItc3R5bGUgcGVybWl0IHNwZWMgZGVjbGFyaW5nXG4gICAqIHdoaWNoIGF0dHJpYnV0ZXMgYW5kIG5lc3RlZCBhdHRyaWJ1dGVzIGFyZSB3cml0YWJsZSBmb3IgdGhlIGN1cnJlbnRcbiAgICogcmVxdWVzdC4gU3VibWl0dGluZyBhbiBhdHRyaWJ1dGUgb3IgbmVzdGVkLXJlbGF0aW9uc2hpcCBrZXkgdGhhdCBpc1xuICAgKiBub3QgcGVybWl0dGVkIHJhaXNlcyBhbiBlcnJvciBhbmQgZmFpbHMgdGhlIHdyaXRlLlxuICAgKlxuICAgKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBmbGF0IGFycmF5IHRoYXQgbWl4ZXM6XG4gICAqICAgLSBgXCJhdHRyaWJ1dGVOYW1lXCJgIHN0cmluZ3MgZm9yIHBsYWluIGF0dHJpYnV0ZSB3cml0ZXNcbiAgICogICAtIGB7PHJlbGF0aW9uc2hpcE5hbWU+QXR0cmlidXRlczogWy4uLl19YCBvYmplY3RzIHdoZXJlIHRoZSB2YWx1ZVxuICAgKiAgICAgaXMgaXRzZWxmIGEgcGVybWl0IHNwZWMgZm9yIHRoZSBuZXN0ZWQgcmVsYXRpb25zaGlwXG4gICAqXG4gICAqIFRoaXMgbWF0Y2hlcyBSYWlscyBzdHJvbmdfcGFyYW1zIChgcGVybWl0KDpmaXJzdF9uYW1lLCA6bGFzdF9uYW1lLFxuICAgKiBjb250YWN0X2F0dHJpYnV0ZXM6IFs6ZW1haWwsIGRldGFpbHNfYXR0cmlidXRlczogWzpkZXRhaWxdXSlgKSBhbmRcbiAgICogdGhlIGFwaV9tYWtlciBzaXN0ZXIgcHJvamVjdC4gSW5jbHVkZSBgXCJfZGVzdHJveVwiYCBpbnNpZGUgYSBuZXN0ZWRcbiAgICogcGVybWl0IHRvIGFsbG93IGBfZGVzdHJveTogdHJ1ZWAgZW50cmllcyBmb3IgdGhhdCByZWxhdGlvbnNoaXAg4oCUXG4gICAqIHRoZSBtb2RlbCBtdXN0IGFsc28gZGVjbGFyZSBgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IobmFtZSxcbiAgICoge2FsbG93RGVzdHJveTogdHJ1ZX0pYCBmb3IgdGhlIGRlc3Ryb3kgdG8gYmUgYXBwbGllZC5cbiAgICpcbiAgICogRXhhbXBsZTpcbiAgICpcbiAgICogICBjbGFzcyBQcm9qZWN0UmVzb3VyY2UgZXh0ZW5kcyBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHtcbiAgICogICAgIHBlcm1pdHRlZFBhcmFtcyhhcmcpIHtcbiAgICogICAgICAgcmV0dXJuIFtcbiAgICogICAgICAgICBcIm5hbWVcIixcbiAgICogICAgICAgICBcImRlc2NyaXB0aW9uXCIsXG4gICAqICAgICAgICAge3Rhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIixcbiAgICogICAgICAgICAgIHtzdWJ0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdfVxuICAgKiAgICAgICAgIF19XG4gICAqICAgICAgIF1cbiAgICogICAgIH1cbiAgICogICB9XG4gICAqXG4gICAqIERlZmF1bHQgaW1wbGVtZW50YXRpb24gcmV0dXJucyB0aGUgZGVjbGFyZWRcbiAgICoge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Uud3JpdGFibGVBdHRyaWJ1dGVzfSBwZXJtaXQgbGlzdCwgb3IgYFtdYFxuICAgKiDigJQgbm90aGluZyBwZXJtaXR0ZWQg4oCUIHdpdGhvdXQgYSBkZWNsYXJlZCBsaXN0LiBTdWJjbGFzc2VzIG92ZXJyaWRlIHRvXG4gICAqIGN1c3RvbWl6ZTsgYW4gZXhwbGljaXQgb3ZlcnJpZGUgYWx3YXlzIHdpbnMuXG4gICAqIEBwYXJhbSB7e2FjdGlvbj86IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiLCBwYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGFiaWxpdHk/OiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCwgbG9jYWxzPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ10gLSBSZXF1ZXN0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBlcm1pdCBzcGVjLlxuICAgKi9cbiAgcGVybWl0dGVkUGFyYW1zKGFyZykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJwZXJtaXR0ZWRQYXJhbXNcIiwgW2FyZ10sICgpID0+IHtcbiAgICAgIHZvaWQgYXJnXG5cbiAgICAgIHJldHVybiB0aGlzLmRlY2xhcmVkV3JpdGFibGVBdHRyaWJ1dGVzKCkgPz8gW11cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkZWNsYXJlZCB3cml0YWJsZS1hdHRyaWJ1dGUgcGVybWl0IGxpc3QgZnJvbSB0aGUgZW52aXJvbm1lbnRcbiAgICogcmVzb3VyY2UgZmlyc3QsIHRoZW4gdGhlIHNoYXJlZCByZXNvdXJjZSDigJQgbWlycm9yaW5nIGhvdyB0aGUgb3RoZXJcbiAgICogc3RhdGljIHJlc291cmNlIGNvbmZpZyByZXNvbHZlcy4gQW4gZXhwbGljaXQgZW52aXJvbm1lbnQgZGVjbGFyYXRpb25cbiAgICogKGluY2x1ZGluZyBgbnVsbGApIHdpbnMgb3ZlciB0aGUgc2hhcmVkIHJlc291cmNlJ3MgbGlzdC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gRGVjbGFyZWQgcGVybWl0IGxpc3Qgb3IgbnVsbCB3aGVuIHVuZGVjbGFyZWQuXG4gICAqL1xuICBkZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgcGVybWl0dGVkQXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7c3RyaW5nW10gfCBudWxsIHwgdW5kZWZpbmVkfSAqLyAoUmVzb3VyY2VDbGFzcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwid3JpdGFibGVBdHRyaWJ1dGVzXCIpKVxuXG4gICAgcmV0dXJuIHBlcm1pdHRlZEF0dHJpYnV0ZXMgPz8gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgY2xpZW50LXNhZmUgZXJyb3IgdGhyb3duIGZvciBhIGZhaWxlZCB3cml0YWJsZS1hdHRyaWJ1dGUgdmFsaWRhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBIdW1hbi1yZWFkYWJsZSB2YWxpZGF0aW9uIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7e2NhdXNlPzogRXJyb3IsIGNvZGU6IHN0cmluZ319IGRldGFpbHMgLSBTdGFibGUgbWFjaGluZS1yZWFkYWJsZSBjb2RlIGFuZCBvcHRpb25hbCBjYXVzZS5cbiAgICogQHJldHVybnMge0Vycm9yfSBDbGllbnQtc2FmZSBlcnJvci5cbiAgICovXG4gIHdyaXRhYmxlQXR0cmlidXRlRXJyb3IobWVzc2FnZSwge2NhdXNlLCBjb2RlfSkge1xuICAgIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKG1lc3NhZ2UsIGNhdXNlID8ge2NhdXNlLCBjb2RlfSA6IHtjb2RlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRob3JpemVzIG9uZSByb3V0ZWQgc3luYyByZXBsYXkgbXV0YXRpb24gYmVmb3JlIGl0IGlzIGFwcGxpZWQuXG4gICAqIERlZmF1bHRzIHRvIGFsbG93aW5nIGV2ZXJ5IG11dGF0aW9uOyByZWNvcmQtbGV2ZWwgYXV0aG9yaXphdGlvbiBzdGlsbFxuICAgKiBhcHBsaWVzIHRocm91Z2gge0BsaW5rIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UjZmluZFN5bmNSZWNvcmR9IHNjb3BpbmdcbiAgICogYW5kIHRoZSBjcmVhdGUgbWVtYmVyc2hpcCBjaGVjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uIHwgUHJvbWlzZTxGcm9udGVuZE1vZGVsU3luY0F1dGhvcml6YXRpb24+fSBBdXRob3JpemF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGF1dGhvcml6ZVN5bmNNdXRhdGlvbih7Y29udGV4dCwgbXV0YXRpb259KSB7XG4gICAgdm9pZCBjb250ZXh0XG4gICAgdm9pZCBtdXRhdGlvblxuXG4gICAgcmV0dXJuIHthbGxvd2VkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHBlci1zeW5jIGZhaWx1cmUgcmVhc29uIHJlcG9ydGVkIHdoZW4gYSByb3V0ZWQgc3luYyBtdXRhdGlvblxuICAgKiBmYWlscyByZWNvcmQtbGV2ZWwgYXV0aG9yaXphdGlvbi4gRGVmYXVsdHMgdG8gbnVsbCwgd2hpY2ggcmVwb3J0cyB0aGVcbiAgICogZ2VuZXJpYyBcImFjY2Vzcy1kZW5pZWRcIiByZWFzb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBhcmdzLmFjdGlvbiAtIERlbmllZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gU3RhYmxlIGZhaWx1cmUgcmVhc29uIGNvZGUgb3IgbnVsbCBmb3IgdGhlIGdlbmVyaWMgZGVmYXVsdC5cbiAgICovXG4gIHN5bmNBdXRob3JpemF0aW9uRmFpbHVyZVJlYXNvbih7YWN0aW9uLCBtdXRhdGlvbn0pIHtcbiAgICB2b2lkIGFjdGlvblxuICAgIHZvaWQgbXV0YXRpb25cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIGV4aXN0aW5nIHJlY29yZCB0YXJnZXRlZCBieSBhIHJvdXRlZCBzeW5jIHJlcGxheSBtdXRhdGlvbi5cbiAgICogRGVmYXVsdHMgdG8gYW4gYGFjY2Vzc2libGVGb3JgIGxvb2t1cCBieSBwcmltYXJ5IGtleSB0aHJvdWdoIHRoZVxuICAgKiByZXNvdXJjZSdzIG5vcm1hbGl6ZWQgYWJpbGl0eSBhY3Rpb24gZm9yIHVwZGF0ZSAob3IgZGVzdHJveSBmb3IgZGVsZXRlXG4gICAqIG11dGF0aW9ucyksIGZhbGxpbmcgYmFjayB0byBhbiB1bnNjb3BlZCBsb29rdXAgd2l0aG91dCBhbiBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IFthcmdzLmFiaWxpdHldIC0gQWJpbGl0eSBvdmVycmlkZS4gRGVmYXVsdHMgdG8gdGhlIHJlc291cmNlIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZm9yRGVsZXRlXSAtIFdoZXRoZXIgdGhlIGxvb2t1cCBpcyBmb3IgYSBkZWxldGUgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSBFeGlzdGluZyByZWNvcmQgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIGZpbmRTeW5jUmVjb3JkKHthYmlsaXR5ID0gdGhpcy5hYmlsaXR5LCBmb3JEZWxldGUgPSBmYWxzZSwgbXV0YXRpb259KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcXVlcnkgPSBhYmlsaXR5XG4gICAgICA/IE1vZGVsQ2xhc3MuYWNjZXNzaWJsZUZvcih0aGlzLnN5bmNBYmlsaXR5QWN0aW9uKGZvckRlbGV0ZSA/IFwiZGVzdHJveVwiIDogXCJ1cGRhdGVcIiksIGFiaWxpdHkpXG4gICAgICA6IE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZmluZEJ5KHtbcHJpbWFyeUtleV06IG11dGF0aW9uLnJlc291cmNlSWR9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcHMgYSByYXcgc3luYyBhY3Rpb24gdG8gdGhlIHJlc291cmNlJ3Mgbm9ybWFsaXplZCBhYmlsaXR5IGFjdGlvbiB3aGVuXG4gICAqIHRoZSByZXNvdXJjZSBjb25maWd1cmF0aW9uIGRlY2xhcmVzIGFuIGFiaWxpdGllcyBtYXBwaW5nLCBvdGhlcndpc2UgdGhlXG4gICAqIHJhdyBhY3Rpb24gbmFtZSBpcyB1c2VkIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwidXBkYXRlXCJ9IGFjdGlvbiAtIFJhdyBzeW5jIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gQWJpbGl0eSBhY3Rpb24uXG4gICAqL1xuICBzeW5jQWJpbGl0eUFjdGlvbihhY3Rpb24pIHtcbiAgICBjb25zdCBhYmlsaXRpZXMgPSB0aGlzLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlPy5hYmlsaXRpZXNcblxuICAgIGlmIChhYmlsaXRpZXMgJiYgdHlwZW9mIGFiaWxpdGllcyA9PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGFiaWxpdGllcylbYWN0aW9uXVxuXG4gICAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gPT0gXCJzdHJpbmdcIiAmJiBhYmlsaXR5QWN0aW9uLmxlbmd0aCA+IDApIHJldHVybiBhYmlsaXR5QWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIGFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZ1bGwgZXNjYXBlIGhhdGNoIGZvciByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi4gUmV0dXJuaW5nIGFcbiAgICogbm9uLW51bGwgcmVzdWx0IHJlcGxhY2VzIHRoZSB3aG9sZSBkZWZhdWx0IGFwcGx5IGZsb3cgKGF1dGhvcml6YXRpb24sXG4gICAqIHJlY29yZCBsb29rdXAsIG5vcm1hbGl6YXRpb24gYW5kIHNhdmUpIHdpdGggdGhlIHJldHVybmVkIGFwcGx5IHJlc3VsdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsQXBwbHlTeW5jQXJnc30gYXJncyAtIEFwcGx5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU3luY0FwcGx5UmVzdWx0IHwgbnVsbCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGw+fSBBcHBseSByZXN1bHQgb3IgbnVsbCBmb3IgdGhlIGRlZmF1bHQgZmxvdy5cbiAgICovXG4gIGFwcGx5U3luYyhhcmdzKSB7XG4gICAgdm9pZCBhcmdzXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgYSByb3V0ZWQgc3luYyBtdXRhdGlvbiB3YXMgYXBwbGllZC4gUmV0dXJuZWQgZW50cmllcyBhcmVcbiAgICogbWVyZ2VkIGludG8gdGhlIGFwcGx5IHJlc3VsdCwgcmVhY2hpbmcgcGVyc2lzdEV4dHJhQXR0cmlidXRlcyBhbmRcbiAgICogYnJvYWRjYXN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5jcmVhdGVkIC0gV2hldGhlciB0aGUgcmVjb3JkIHdhcyBjcmVhdGVkLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGFyZ3MucmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gRXh0cmEgYXBwbHktcmVzdWx0IGVudHJpZXMuXG4gICAqL1xuICBhZnRlclN5bmNBcHBseSh7Y29udGV4dCwgY3JlYXRlZCwgbXV0YXRpb24sIHJlY29yZH0pIHtcbiAgICB2b2lkIGNvbnRleHRcbiAgICB2b2lkIGNyZWF0ZWRcbiAgICB2b2lkIG11dGF0aW9uXG4gICAgdm9pZCByZWNvcmRcblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgY3JlYXRlIGF0dHJpYnV0ZXMgYmVmb3JlIHBlcm1pc3Npb24gZmlsdGVyaW5nIGFuZCBzYXZpbmcuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIEluY29taW5nIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZD59IC0gTm9ybWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbm9ybWFsaXplQ3JlYXRlQXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcIm5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXNcIiwgW2F0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgdXBkYXRlIGF0dHJpYnV0ZXMgYmVmb3JlIHBlcm1pc3Npb24gZmlsdGVyaW5nIGFuZCBzYXZpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIEluY29taW5nIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZD59IC0gTm9ybWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgbm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVVcGRhdGVBdHRyaWJ1dGVzXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgb3B0aW9uc1xuXG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgY3JlYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE5ldyBtb2RlbCBiZWZvcmUgYXNzaWdubWVudC9zYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZUNyZWF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVDcmVhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgY3JlYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIENyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgY3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJDcmVhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbCBiZWZvcmUgYXNzaWdubWVudC9zYXZlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZVVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVVcGRhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIFVwZGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIE5vcm1hbGl6ZWQgdXBkYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IG9wdGlvbnMgLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYWZ0ZXJVcGRhdGVcIiwgW21vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgICAgdm9pZCBhdHRyaWJ1dGVzXG4gICAgICB2b2lkIG9wdGlvbnNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYmVmb3JlRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJiZWZvcmVEZXN0cm95XCIsIFttb2RlbF0sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBEZXN0cm95ZWQgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkIHwgUHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBob29rIGZpbmlzaGVzLlxuICAgKi9cbiAgYWZ0ZXJEZXN0cm95KG1vZGVsKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBXcmFwcyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgcmVzb3VyY2UgbXV0YXRpb25zLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gVHJhbnNhY3Rpb24gYXJncy5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIE11dGF0aW9uIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbCAtIE11dGF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXN1bHQ+fSBhcmdzLmNhbGxiYWNrIC0gTXV0YXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuTXV0YXRpb25UcmFuc2FjdGlvbih7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9KSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcInJ1bk11dGF0aW9uVHJhbnNhY3Rpb25cIiwgW3thY3Rpb24sIG1vZGVsLCBjYWxsYmFja31dLCBhc3luYyAoKSA9PiB7XG4gICAgICB2b2lkIGFjdGlvblxuICAgICAgdm9pZCBtb2RlbFxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQcmltYXJ5IGtleS5cbiAgICovXG4gIHByaW1hcnlLZXkoKSB7IHJldHVybiB0aGlzLm1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9ufSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1vZGVsQ2xhc3M+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBhdXRob3JpemVkUXVlcnkoYWN0aW9uKSB7XG4gICAgLy8gTmFycm93cyB0aGUgY29udHJvbGxlciBxdWVyeSB0byB0aGlzIHJlc291cmNlJ3MgbW9kZWwgY2xhc3MuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxUTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnkoYWN0aW9uKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxUTW9kZWxDbGFzcz59IC0gRnJvbnRlbmQtbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqL1xuICBpbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5KHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICByZXNvdXJjZTogdGhpc1xuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggcGFnaW5hdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYWdpbmF0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbn0gYXJncy5wYWdpbmF0aW9uIC0gUGFnaW5hdGlvbiBwYXJhbXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFBhZ2luYXRpb24oe2NvbnRyb2xsZXIsIHBhZ2luYXRpb24sIHF1ZXJ5fSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbih7cGFnaW5hdGlvbiwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc2VhcmNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlYXJjaCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTZWFyY2goe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc29ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0fSBhcmdzLnNvcnQgLSBTb3J0IHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNvcnQoe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzb3J0fSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU29ydCh7cXVlcnksIHNvcnR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgcGx1Y2suXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgcGx1Y2sgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNQbHVjayhhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5yZWNvcmRzID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5yZWNvcmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBjb3VudC5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBjb3VudCBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0NvdW50KGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLnJlY29yZHMgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLnJlY29yZHMgfHxcbiAgICAgIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5jb3VudCAhPT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUuY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCB2b2lkIHwgUHJvbWlzZTxib29sZWFuIHwgdm9pZD59IC0gQ29udGludWUgcHJvY2Vzc2luZyB1bmxlc3MgZmFsc2UuXG4gICAqL1xuICBiZWZvcmVBY3Rpb24oYWN0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZUFjdGlvblwiLCBbYWN0aW9uXSwgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cblxuICAgICAgLy8gTm8tb3AgYnkgZGVmYXVsdC5cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gUmVjb3JkcyBmb3IgaW5kZXggYWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeSBvcHRpb25zIGZvciBjb3VudC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSAtIEluZGV4IHF1ZXJ5IG9wdGlvbnMgZm9yIGNvdW50LlxuICAgKi9cbiAgY291bnRJbmRleFF1ZXJ5T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlY29yZHMgY291bnQgZm9yIGluZGV4IGFjdGlvbi5cbiAgICovXG4gIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmluZGV4UXVlcnkodGhpcy5jb3VudEluZGV4UXVlcnlPcHRpb25zKCkpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7XCJmaW5kXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gTG9jYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIGZpbmQoYWN0aW9uLCBpZCkge1xuICAgIGxldCBxdWVyeSA9IHRoaXMuYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICBjb25zdCBwcmVsb2FkID0gYWN0aW9uID09PSBcImZpbmRcIiA/IHRoaXMudHlwZWRDb250cm9sbGVySW5zdGFuY2UoKS5mcm9udGVuZE1vZGVsUHJlbG9hZCgpIDogbnVsbFxuXG4gICAgaWYgKHByZWxvYWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5maW5kQnkoe1t0aGlzLnByaW1hcnlLZXkoKV06IGlkfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gQ3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnN9IFtvcHRpb25zXSAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIENyZWF0ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBjcmVhdGUoYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcImNyZWF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBNb2RlbENsYXNzID0gdGhpcy5tb2RlbENsYXNzKClcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXModGhpcy5tb2RlbENsYXNzKCkucHJvdG90eXBlLCBNb2RlbENsYXNzLCBhdHRhY2htZW50U3BsaXQuYXR0cmlidXRlcywgdGhpcywgcGVybWl0LmF0dHJpYnV0ZXMpXG4gICAgY29uc3QgbW9kZWwgPSBuZXcgTW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJjcmVhdGVcIixcbiAgICAgIG1vZGVsLFxuICAgICAgY2FsbGJhY2s6IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWZvcmVDcmVhdGUobW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuICAgICAgICBjb25zdCBzYXZlZE1vZGVsID0gYXdhaXQgdGhpcy5fc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnM6IHsuLi5vcHRpb25zLCBhdHRhY2htZW50czogYXR0YWNobWVudFNwbGl0LmF0dGFjaG1lbnRzfSwgcGVybWl0fSlcblxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyQ3JlYXRlKHNhdmVkTW9kZWwsIG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zKVxuXG4gICAgICAgIHJldHVybiBzYXZlZE1vZGVsXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZSB1bmF1dGhvcml6ZWQgY3JlYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDbGVhbnVwIGFmdGVyIGZhaWxlZCBhdXRob3JpemF0aW9uLlxuICAgKi9cbiAgYXN5bmMgaGFuZGxlVW5hdXRob3JpemVkQ3JlYXRlZE1vZGVsKG1vZGVsKSB7XG4gICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIFVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBVcGRhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgdXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMubm9ybWFsaXplVXBkYXRlQXR0cmlidXRlcyhtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucylcbiAgICBjb25zdCBhdHRhY2htZW50U3BsaXQgPSB0aGlzLl9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMobm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbClcbiAgICBjb25zdCBwZXJtaXQgPSBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczogbm9ybWFsaXplZEF0dHJpYnV0ZXN9KSlcbiAgICBjb25zdCBmaWx0ZXJlZCA9IGZpbHRlcldyaXRhYmxlRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwsIG1vZGVsLmdldE1vZGVsQ2xhc3MoKSwgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlVXBkYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlclVwZGF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgYSBtb2RlbCBhbmQgYXBwbGllcyBuZXN0ZWQgYXR0cmlidXRlcyBpbiBvbmUgdHJhbnNhY3Rpb24uXG4gICAqIEBwYXJhbSB7e2ZpbHRlcmVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG1vZGVsOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgb3B0aW9uczogRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnMsIHBlcm1pdDoge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19fSBhcmdzIC0gU2F2ZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBTYXZlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9ucywgcGVybWl0fSkge1xuICAgIGF3YWl0IHRoaXMubW9kZWxDbGFzcygpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhtb2RlbCwgZmlsdGVyZWQpXG4gICAgICB0aGlzLl9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgb3B0aW9ucy5hdHRhY2htZW50cyA/PyBudWxsLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgICAgaWYgKG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICBhd2FpdCB0aGlzLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMobW9kZWwsIG9wdGlvbnMubmVzdGVkQXR0cmlidXRlcywgb3B0aW9ucy5jb250cm9sbGVyIHx8IG51bGwsIHBlcm1pdClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbW9kZWwuc2F2ZSgpXG5cbiAgICAgIGlmIChvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKG1vZGVsLCBvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMsIG9wdGlvbnMuY29udHJvbGxlciB8fCBudWxsLCBwZXJtaXQpXG4gICAgICB9XG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX3ByZWxvYWROZXN0ZWRXcml0YWJsZVJlbGF0aW9uc2hpcHMobW9kZWwsIHBlcm1pdClcblxuICAgIHJldHVybiBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgYXR0cmlidXRlcyB0byBhIG1vZGVsLCB1c2luZyB2aXJ0dWFsIHNldHRlcnMgb24gdGhlIHJlc291cmNlIHdoZW4gYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgdG8gYXNzaWduLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMobW9kZWwsIGF0dHJpYnV0ZXMpIHtcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBkaXJlY3RBdHRyaWJ1dGVzID0ge31cbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpXG4gICAgY29uc3QgdHJhbnNsYXRlZFNldCA9IG5ldyBTZXQoUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdKVxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCByZXNvdXJjZVNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpfUF0dHJpYnV0ZWBcbiAgICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gdGhpcy5yZXNvdXJjZU1ldGhvZChyZXNvdXJjZVNldHRlck5hbWUpXG5cbiAgICAgIGlmIChyZXNvdXJjZVNldHRlcikge1xuICAgICAgICBhd2FpdCByZXNvdXJjZVNldHRlci5tZXRob2QuY2FsbChyZXNvdXJjZVNldHRlci5yZXNvdXJjZSwgbW9kZWwsIHZhbHVlKVxuICAgICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhuYW1lKSkge1xuICAgICAgICBhd2FpdCB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlT25Nb2RlbChtb2RlbCwgbmFtZSwgdmFsdWUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaXJlY3RBdHRyaWJ1dGVzW25hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZGlyZWN0QXR0cmlidXRlcykubGVuZ3RoID4gMCkge1xuICAgICAgbW9kZWwuYXNzaWduKGRpcmVjdEF0dHJpYnV0ZXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNwbGl0cyBhdHRhY2htZW50LW5hbWVkIGF0dHJpYnV0ZXMgaW50byB0aGUgYXR0YWNobWVudCBwYXlsb2FkIHdoaWxlIHByZXNlcnZpbmcgbGVnYWN5IGNhbGxlcnNcbiAgICogdGhhdCBzdWJtaXR0ZWQgYXR0YWNobWVudHMgYXMgbm9ybWFsIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gSW5jb21pbmcgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEV4cGxpY2l0IGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGF0dGFjaG1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfX0gQXR0cmlidXRlcyB3aXRoIGF0dGFjaG1lbnQga2V5cyByZW1vdmVkIGFuZCBtZXJnZWQgYXR0YWNobWVudCBwYXlsb2FkLlxuICAgKi9cbiAgX2V4dHJhY3RBdHRhY2htZW50QXR0cmlidXRlcyhhdHRyaWJ1dGVzLCBhdHRhY2htZW50cykge1xuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRoaXMubW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgICBjb25zdCBhdHRhY2htZW50TmFtZXMgPSBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dGFjaG1lbnREZWZpbml0aW9ucykpXG5cbiAgICBpZiAoYXR0YWNobWVudE5hbWVzLnNpemUgPT09IDApIHJldHVybiB7YXR0cmlidXRlcywgYXR0YWNobWVudHN9XG5cbiAgICBpZiAoYXR0YWNobWVudHMgIT09IG51bGwgJiYgIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVndWxhckF0dHJpYnV0ZXMgPSB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gKi9cbiAgICBsZXQgbWVyZ2VkQXR0YWNobWVudHMgPSBhdHRhY2htZW50cyA/IHsuLi5hdHRhY2htZW50c30gOiBudWxsXG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGlmICghYXR0YWNobWVudE5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICByZWd1bGFyQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWVyZ2VkQXR0YWNobWVudHMpIG1lcmdlZEF0dGFjaG1lbnRzID0ge31cbiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobWVyZ2VkQXR0YWNobWVudHMsIGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAnJHthdHRyaWJ1dGVOYW1lfScgd2FzIHN1Ym1pdHRlZCBpbiBib3RoIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzLmApXG4gICAgICB9XG5cbiAgICAgIG1lcmdlZEF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4ge2F0dHJpYnV0ZXM6IHJlZ3VsYXJBdHRyaWJ1dGVzLCBhdHRhY2htZW50czogbWVyZ2VkQXR0YWNobWVudHN9XG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGF0dGFjaG1lbnQgcGF5bG9hZHMgb24gYSBtb2RlbCBhZnRlciB2YWxpZGF0aW5nIHBlcm1pdHMgYW5kIGF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgcmVjZWl2aW5nIGF0dGFjaG1lbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGF0dGFjaG1lbnRzIC0gQXR0YWNobWVudHMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyAtIEF0dHJpYnV0ZS9hdHRhY2htZW50IG5hbWVzIHBlcm1pdHRlZCBieSB0aGUgcmVzb3VyY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2lnbkF0dGFjaG1lbnRzKG1vZGVsLCBhdHRhY2htZW50cywgcGVybWl0dGVkQXR0cmlidXRlTmFtZXMpIHtcbiAgICBpZiAoIWF0dGFjaG1lbnRzKSByZXR1cm5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0YWNobWVudHMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICBjb25zdCBwZXJtaXRTZXQgPSBuZXcgU2V0KHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbC5nZXRNb2RlbENsYXNzKClcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSBtb2RlbENsYXNzLmdldEF0dGFjaG1lbnRzTWFwKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzID0gW11cbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGludmFsaWRBdHRhY2htZW50cyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFthdHRhY2htZW50TmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dGFjaG1lbnRzKSkge1xuICAgICAgaWYgKCFwZXJtaXRTZXQuaGFzKGF0dGFjaG1lbnROYW1lKSkge1xuICAgICAgICBub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgaWYgKCFhdHRhY2htZW50RGVmaW5pdGlvbnNbYXR0YWNobWVudE5hbWVdKSB7XG4gICAgICAgIGludmFsaWRBdHRhY2htZW50cy5wdXNoKGF0dGFjaG1lbnROYW1lKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5xdWV1ZUF0dGFjaCh2YWx1ZSlcbiAgICB9XG5cbiAgICBpZiAobm90UGVybWl0dGVkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgRnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lcyBub3QgcGVybWl0dGVkIGJ5IHBlcm1pdHRlZFBhcmFtcygpOiAke25vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmpvaW4oXCIsIFwiKX1gLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1hdHRyaWJ1dGUtZXJyb3JcIn0pXG4gICAgfVxuICAgIGlmIChpbnZhbGlkQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgSW52YWxpZCBmcm9udGVuZCBtb2RlbCBhdHRhY2htZW50IG5hbWVzOiAke2ludmFsaWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgb24gYSBtb2RlbCB2aWEgdGhlIHRyYW5zbGF0aW9ucyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSB2YWx1ZSAtIEF0dHJpYnV0ZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuY29udGV4dD8uY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGxvY2FsZSA9IGNvbmZpZ3VyYXRpb24gPyBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpIDogXCJlblwiXG4gICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBtb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRyYW5zbGF0aW9uXG5cbiAgICBpZiAobW9kZWwuaXNOZXdSZWNvcmQoKSkge1xuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHtcbiAgICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChcInRyYW5zbGF0aW9uc1wiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgIHRyYW5zbGF0aW9uID0gbG9hZGVkLmZpbmQoKHQpID0+IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodCkubG9jYWxlKCkgPT09IGxvY2FsZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXRyYW5zbGF0aW9uKSB7XG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGFzc2lnbm1lbnRzID0ge31cblxuICAgIGFzc2lnbm1lbnRzW25hbWVdID0gdmFsdWVcbiAgICB0cmFuc2xhdGlvbi5hc3NpZ24oYXNzaWdubWVudHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KG1vZGVsKSB7XG4gICAgYXdhaXQgdGhpcy5ydW5NdXRhdGlvblRyYW5zYWN0aW9uKHtcbiAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlRGVzdHJveShtb2RlbClcbiAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJEZXN0cm95KG1vZGVsKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgdG8gc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCJ9IFthY3Rpb25dIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNlcmlhbGl6ZWQgbW9kZWwgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZShtb2RlbCwgYWN0aW9uKSB7XG4gICAgdm9pZCBhY3Rpb25cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuc2VyaWFsaXplRnJvbnRlbmRNb2RlbChtb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb21tb24gbWV0YWRhdGEgZm9yIG9uZSBuZXN0ZWQtYXR0cmlidXRlcyByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIHJlbGF0aW9uc2hpcCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIHJlY2VpdmluZyBuZXN0ZWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWV9IGFyZ3MucmF3RW50cmllcyAtIFJhdyBuZXN0ZWQgZW50cmllcyBmcm9tIHRoZSByZXF1ZXN0IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MuY2hpbGRQZXJtaXQgLSBQYXJzZWQgY2hpbGQgcGVybWl0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLmNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciBjaGlsZCByZXNvdXJjZSBsb29rdXAuXG4gICAqIEByZXR1cm5zIHt7YWJpbGl0eTogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGNoaWxkUmVzb3VyY2U6IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UsIGNoaWxkUmVzb3VyY2VDb25maWc6IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvbiwgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBkZXN0cm95UGVybWl0dGVkOiBib29sZWFuLCBlbnRyaWVzOiBBcnJheTxGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeT4sIHJlbGF0aW9uc2hpcDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0LCB0YXJnZXRNb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBOZXN0ZWQgcmVsYXRpb25zaGlwIGNvbnRleHQuXG4gICAqL1xuICBfbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7cGFyZW50LCByZWxhdGlvbnNoaXBOYW1lLCByYXdFbnRyaWVzLCBjaGlsZFBlcm1pdCwgY29udHJvbGxlcn0pIHtcbiAgICBpZiAoIWNvbnRyb2xsZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9JyByZXF1aXJlIGEgY29udHJvbGxlciBpbnN0YW5jZS5gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcmVudE1vZGVsQ2xhc3MgPSBwYXJlbnQuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgbW9kZWxBY2NlcHRhbmNlID0gcGFyZW50TW9kZWxDbGFzcy5hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGlmICghbW9kZWxBY2NlcHRhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1vZGVsICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfSBkb2VzIG5vdCBhY2NlcHQgbmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9Jy4gRGVjbGFyZSBpdCB2aWEgJHtwYXJlbnRNb2RlbENsYXNzLm5hbWV9LmFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKCcke3JlbGF0aW9uc2hpcE5hbWV9JykuYClcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBwYXJlbnRNb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcFR5cGUgPSByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpXG4gICAgY29uc3QgcmF3Tm9ybWFsaXplZEVudHJpZXMgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBFbnRyaWVzKHtyYXdFbnRyaWVzLCByZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBUeXBlfSlcbiAgICBjb25zdCBkZXN0cm95UGVybWl0dGVkID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5pbmNsdWRlcyhcIl9kZXN0cm95XCIpXG5cbiAgICBpZiAoZGVzdHJveVBlcm1pdHRlZCAmJiAhbW9kZWxBY2NlcHRhbmNlLmFsbG93RGVzdHJveSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSBwZXJtaXRzIF9kZXN0cm95IG9uIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgdGhlIG1vZGVsICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfSBkb2VzIG5vdCBhbGxvdyBkZXN0cm95IGZvciB0aGF0IHJlbGF0aW9uc2hpcC4gU2V0IHthbGxvd0Rlc3Ryb3k6IHRydWV9IG9uICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScsIC4uLikuYClcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBtb2RlbEFjY2VwdGFuY2UubGltaXQgPT09IFwibnVtYmVyXCIgJiYgcmF3Tm9ybWFsaXplZEVudHJpZXMubGVuZ3RoID4gbW9kZWxBY2NlcHRhbmNlLmxpbWl0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBleGNlZWRzIG1vZGVsLWRlY2xhcmVkIGxpbWl0IG9mICR7bW9kZWxBY2NlcHRhbmNlLmxpbWl0fS5gKVxuICAgIH1cbiAgICBpZiAocmVsYXRpb25zaGlwVHlwZSAhPT0gXCJoYXNNYW55XCIgJiYgcmF3Tm9ybWFsaXplZEVudHJpZXMubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYWNjZXB0cyBvbmUgZW50cnkgZm9yICR7cmVsYXRpb25zaGlwVHlwZX0gcmVsYXRpb25zaGlwcy5gKVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIHJlc29sdmVkIGZvciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nIG9uICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5gKVxuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkUmVzb3VyY2VDb25maWcgPSBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWNoaWxkUmVzb3VyY2VDb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcmVnaXN0ZXJlZCBmb3IgY2hpbGQgbW9kZWwgJyR7dGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0nIHVuZGVyIHJlbGF0aW9uc2hpcCAnJHtyZWxhdGlvbnNoaXBOYW1lfScuYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlID0gbmV3IGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDbGFzcyh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyLFxuICAgICAgY29udGV4dDogdGhpcy5jb250ZXh0IHx8IHt9LFxuICAgICAgbG9jYWxzOiB0aGlzLmxvY2FscyB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBtb2RlbE5hbWU6IGNoaWxkUmVzb3VyY2VDb25maWcubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiBjb250cm9sbGVyLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzID0gY2hpbGRQZXJtaXQuYXR0cmlidXRlcy5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiX2Rlc3Ryb3lcIilcbiAgICBjb25zdCBlbnRyaWVzID0gcmF3Tm9ybWFsaXplZEVudHJpZXNcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkpXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIG1vZGVsQWNjZXB0YW5jZS5yZWplY3RJZiAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdHJ1ZVxuXG4gICAgICAgIHJldHVybiAhbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmKGlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykgPyBlbnRyeS5hdHRyaWJ1dGVzIDoge30pXG4gICAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdHk6IGNvbnRyb2xsZXIuY3VycmVudEFiaWxpdHkoKSB8fCB0aGlzLmFiaWxpdHksXG4gICAgICBjaGlsZFJlc291cmNlLFxuICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZyxcbiAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgZGVzdHJveVBlcm1pdHRlZCxcbiAgICAgIGVudHJpZXMsXG4gICAgICByZWxhdGlvbnNoaXAsXG4gICAgICB0YXJnZXRNb2RlbENsYXNzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgbmVzdGVkIGVudHJpZXMgZm9yIGNvbGxlY3Rpb24gYW5kIHNpbmd1bGFyIHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIGVudHJpZXMgaW5wdXRzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gYXJncy5yYXdFbnRyaWVzIC0gUmF3IG5lc3RlZCBlbnRyaWVzIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5Pn0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkgb2JqZWN0cy5cbiAgICovXG4gIF9uZXN0ZWRSZWxhdGlvbnNoaXBFbnRyaWVzKHtyYXdFbnRyaWVzLCByZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBUeXBlfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJhd0VudHJpZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXJyYXkgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHJhd0VudHJpZXMgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghaXNQbGFpbk9iamVjdChyYXdFbnRyaWVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgcmV0dXJuIFsvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAocmF3RW50cmllcyldXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmVzdGVkIGVudHJ5IGZyb20gZWl0aGVyIGludGVybmFsIHRyYW5zcG9ydCBzaGFwZVxuICAgKiAoYHthdHRyaWJ1dGVzLCBhdHRhY2htZW50cywgbmVzdGVkQXR0cmlidXRlc31gKSBvciBkaXJlY3QgUmFpbHMtc3R5bGVcbiAgICogZmllbGRzIChge25hbWUsIGZpbGUsIGNvbW1lbnRzQXR0cmlidXRlc31gKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOb3JtYWxpemF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncy5jaGlsZFBlcm1pdCAtIFBhcnNlZCBjaGlsZCBwZXJtaXQgc3BlYy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gYXJncy5lbnRyeSAtIFJhdyBuZXN0ZWQgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeS5cbiAgICovXG4gIF9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0YWNobWVudHMgPSB7fVxuICAgIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gKi9cbiAgICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9ucyA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0QXR0YWNobWVudHNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiaWRcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGlkIG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLmlkID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiX2Rlc3Ryb3lcIikge1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IF9kZXN0cm95IG11c3QgYmUgYSBib29sZWFuLmApXG4gICAgICAgIH1cblxuICAgICAgICBub3JtYWxpemVkLl9kZXN0cm95ID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwiYXR0YWNobWVudHNcIikge1xuICAgICAgICBpZiAoIWlzUGxhaW5PYmplY3QodmFsdWUpKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBlbnRyeSBhdHRhY2htZW50cyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dGFjaG1lbnRzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IFwibmVzdGVkQXR0cmlidXRlc1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IG5lc3RlZEF0dHJpYnV0ZXMgbXVzdCBiZSBhbiBvYmplY3QuYClcbiAgICAgICAgT2JqZWN0LmFzc2lnbihuZXN0ZWRBdHRyaWJ1dGVzLCB2YWx1ZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICAgIGNvbnN0IG5lc3RlZFJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgbmVzdGVkIGF0dHJpYnV0ZXMga2V5OiAke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgICAgaWYgKCFjaGlsZFBlcm1pdC5uZXN0ZWRbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0pIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lfScgYXJlIG5vdCBwZXJtaXR0ZWQgdW5kZXIgJyR7cmVsYXRpb25zaGlwTmFtZX0nLiBJbmNsdWRlIHske2F0dHJpYnV0ZU5hbWV9OiBbLi4uXX0gaW4gdGhhdCBuZXN0ZWQgcGVybWl0LmApXG4gICAgICAgIH1cblxuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzW25lc3RlZFJlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGF0dGFjaG1lbnREZWZpbml0aW9uc1thdHRyaWJ1dGVOYW1lXSkge1xuICAgICAgICBhdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoYXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIGlmIChPYmplY3Qua2V5cyhhdHRhY2htZW50cykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5hdHRhY2htZW50cyA9IGF0dGFjaG1lbnRzXG4gICAgaWYgKE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIG5vcm1hbGl6ZWQubmVzdGVkQXR0cmlidXRlcyA9IG5lc3RlZEF0dHJpYnV0ZXNcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBiZWxvbmdzLXRvIG5lc3RlZCBhdHRyaWJ1dGVzIGJlZm9yZSB0aGUgcGFyZW50IHNhdmUgc28gdGhlIHBhcmVudCBGSyBjYW4gYmUgc2V0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChjb250ZXh0LnJlbGF0aW9uc2hpcCwgcGFyZW50LmdldE1vZGVsQ2xhc3MoKSlcblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjb250ZXh0LmVudHJpZXMpIHtcbiAgICAgICAgaWYgKGVudHJ5Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG5cbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmROZXN0ZWRSZWNvcmQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgICAgIHBhcmVudC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgbnVsbClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuICAgICAgICBjb25zdCBjaGlsZCA9IGlkICE9IHVuZGVmaW5lZFxuICAgICAgICAgID8gYXdhaXQgdGhpcy5fZmluZE5lc3RlZFJlY29yZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICAgIH0pXG4gICAgICAgICAgOiBuZXcgY29udGV4dC50YXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5fYXV0aG9yaXplQ3JlYXRlZENoaWxkKHtcbiAgICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG5cbiAgICAgICAgcGFyZW50LnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBjaGlsZC5pZCgpKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgYG5lc3RlZEF0dHJpYnV0ZXNgIHBheWxvYWQgdG8gYSBmcmVzaGx5LXNhdmVkIHBhcmVudCBtb2RlbCxcbiAgICogY2FzY2FkaW5nIGNyZWF0ZS91cGRhdGUvZGVzdHJveSB3cml0ZXMgYWNyb3NzIHRoZSBkZWNsYXJlZCByZWxhdGlvbnNoaXBzLlxuICAgKlxuICAgKiBFYWNoIGNoaWxkIGlzIGF1dGhvcml6ZWQgYWdhaW5zdCBpdHMgb3duIHJlc291cmNlJ3MgYWJpbGl0aWVzIChuZXZlciB0aGVcbiAgICogcGFyZW50J3MpLiBEZXN0cm95cyBydW4gYmVmb3JlIHVwZGF0ZXMsIHVwZGF0ZXMgYmVmb3JlIGNyZWF0ZXMsIHRvIGF2b2lkXG4gICAqIHVuaXF1ZS1jb25zdHJhaW50IGNvbmZsaWN0cyB3aGVuIHJlcGxhY2luZyBhIGNoaWxkIGF0IHRoZSBzYW1lIG5hdHVyYWwga2V5LlxuICAgKlxuICAgKiBBdHRyaWJ1dGUgZmlsdGVyaW5nIGZvciBuZXN0ZWQgY2hpbGRyZW4gdXNlcyB0aGUgcGFyZW50IHJlc291cmNlJ3NcbiAgICogcGVybWl0IHNwZWMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlCBhcGlfbWFrZXItc3R5bGUuIFBvbGljeSBvcHRpb25zXG4gICAqIChhbGxvd0Rlc3Ryb3ksIGxpbWl0LCByZWplY3RJZikgY29tZSBmcm9tIHRoZSBNT0RFTCdzXG4gICAqIGBhY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNGb3IobmFtZSlgIGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBwYXJlbnQgLSBQYXJlbnQgbW9kZWwgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gbmVzdGVkQXR0cmlidXRlcyAtIE5lc3RlZC1hdHRyaWJ1dGUgcGF5bG9hZCBrZXllZCBieSByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gY29udHJvbGxlciAtIENvbnRyb2xsZXIgaW5zdGFuY2UgZm9yIHJlc291cmNlIHJlc29sdXRpb24gYW5kIGF1dGhvcml6YXRpb24uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCBudWxsfSBbcGFyZW50UGVybWl0XSAtIFBhcnNlZCBwYXJlbnQgcGVybWl0IHNwZWMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhwYXJlbnQsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIHBhcmVudFBlcm1pdCA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvbHZlZFBhcmVudCA9IHBhcmVudFBlcm1pdFxuICAgICAgfHwgcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IHt9fSkpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGNoaWxkUGVybWl0ID0gcmVzb2x2ZWRQYXJlbnQubmVzdGVkW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmICghY2hpbGRQZXJtaXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgYXR0cmlidXRlcyBmb3IgJyR7cmVsYXRpb25zaGlwTmFtZX0nIGFyZSBub3QgcGVybWl0dGVkIGJ5ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS5wZXJtaXR0ZWRQYXJhbXMoKS4gSW5jbHVkZSB7JHtyZWxhdGlvbnNoaXBOYW1lfUF0dHJpYnV0ZXM6IFsuLi5dfSBpbiB0aGUgcmV0dXJuZWQgcGVybWl0LmApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLl9uZXN0ZWRSZWxhdGlvbnNoaXBDb250ZXh0KHtcbiAgICAgICAgY2hpbGRQZXJtaXQsXG4gICAgICAgIGNvbnRyb2xsZXIsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmF3RW50cmllczogbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbnRleHQucmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgICAgY29uc3QgcGFyZW50TGlua0F0dHJpYnV0ZXMgPSB0aGlzLl9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByZWxhdGlvbnNoaXA6IGNvbnRleHQucmVsYXRpb25zaGlwLFxuICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IGRlc3Ryb3lFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IHVwZGF0ZUVudHJpZXMgPSBbXVxuICAgICAgY29uc3QgY3JlYXRlRW50cmllcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY29udGV4dC5lbnRyaWVzKSB7XG4gICAgICAgIGlmIChlbnRyeT8uX2Rlc3Ryb3kpIHtcbiAgICAgICAgICBpZiAoIWNvbnRleHQuZGVzdHJveVBlcm1pdHRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgcmVxdWVzdGVkIF9kZXN0cm95IGJ1dCBcIl9kZXN0cm95XCIgaXMgbm90IGluIHRoZSBwZXJtaXQgZm9yIHRoaXMgcmVsYXRpb25zaGlwLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZW50cnkuaWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVzdHJveUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfSBlbHNlIGlmIChlbnRyeT8uaWQpIHtcbiAgICAgICAgICB1cGRhdGVFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3JlYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZGVzdHJveUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLmRlc3Ryb3koZXhpc3RpbmcpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdXBkYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG5cbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIHVwZGF0ZSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuX2ZpbmRTY29wZWRDaGlsZCh7XG4gICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBwYXJlbnQsXG4gICAgICAgICAgcGFyZW50TGlua0F0dHJpYnV0ZXMsXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQ6IGV4aXN0aW5nLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGV4aXN0aW5nLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgZXhpc3Rpbmcuc2F2ZSgpXG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjcmVhdGVFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkID0gbmV3IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgY2hpbGQuYXNzaWduKHBhcmVudExpbmtBdHRyaWJ1dGVzKVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7XG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXM6IGNvbnRleHQuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgZW50cnlcbiAgICAgICAgfSlcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseUJlbG9uZ3NUb05lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMgfHwge30sIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICBhd2FpdCBjaGlsZC5zYXZlKClcblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoY2hpbGQsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgb25lIG5lc3RlZCBlbnRyeSdzIGF0dHJpYnV0ZXMgYW5kIGF0dGFjaG1lbnRzIHRvIGEgY2hpbGQgbW9kZWwuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzaWdubWVudCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCByZWNlaXZpbmcgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyAtIFBlcm1pdHRlZCBjaGlsZCBhdHRyaWJ1dGUgYW5kIGF0dGFjaG1lbnQgbmFtZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmVudHJ5IC0gTmVzdGVkIGVudHJ5IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2Fzc2lnbk5lc3RlZEVudHJ5VG9DaGlsZCh7Y2hpbGQsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLCBlbnRyeX0pIHtcbiAgICBpZiAoZW50cnkuYXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRyaWJ1dGVzIHRvIGJlIGFuIG9iamVjdC5cIilcblxuICAgICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKGNoaWxkLCBjaGlsZC5nZXRNb2RlbENsYXNzKCksIGVudHJ5LmF0dHJpYnV0ZXMsIHRoaXMsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICAgICAgYXdhaXQgdGhpcy5fYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKGNoaWxkLCBmaWx0ZXJlZClcbiAgICB9XG5cbiAgICBpZiAoZW50cnkuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCAmJiAhaXNQbGFpbk9iamVjdChlbnRyeS5hdHRhY2htZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5lc3RlZCBlbnRyeSBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMoY2hpbGQsIGVudHJ5LmF0dGFjaG1lbnRzID8/IG51bGwsIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgcmVsYXRpb25zaGlwJ3MgZm9yZWlnbi1rZXkgY29sdW1uL25hbWUgdG8gdGhlIHRhcmdldCBtb2RlbCdzIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGNvbnRhaW5pbmcgdGhlIEZLLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBGb3JlaWduLWtleSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIF9mb3JlaWduS2V5QXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgIHJldHVybiBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtmb3JlaWduS2V5XSB8fCBmb3JlaWduS2V5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgRksgYXR0cmlidXRlcyB0aGF0IGJpbmQgYSBuZXN0ZWQgY2hpbGQgdG8gaXRzIHBhcmVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYXJlbnQtbGluayBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IEF0dHJpYnV0ZXMgdGhhdCBzY29wZSB0aGUgY2hpbGQgdG8gdGhlIHBhcmVudC5cbiAgICovXG4gIF9wYXJlbnRMaW5rQXR0cmlidXRlc0Zvck5lc3RlZENoaWxkKHtwYXJlbnQsIHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgdGFyZ2V0TW9kZWxDbGFzcylcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHtbZm9yZWlnbktleV06IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAocGFyZW50LmlkKCkpfVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpKSB7XG4gICAgICBjb25zdCB0eXBlQXR0cmlidXRlID0gdGhpcy5fcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCB0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICBhdHRyaWJ1dGVzW3R5cGVBdHRyaWJ1dGVdID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSByZWxhdGlvbnNoaXAncyBwb2x5bW9ycGhpYyB0eXBlIGNvbHVtbi9uYW1lIHRvIGEgY2hpbGQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSByZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgY29udGFpbmluZyB0aGUgdHlwZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFBvbHltb3JwaGljIHR5cGUgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfcG9seW1vcnBoaWNUeXBlQXR0cmlidXRlRm9yTW9kZWwocmVsYXRpb25zaGlwLCBtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgdHlwZUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpY1R5cGVDb2x1bW4oKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3R5cGVDb2x1bW5dIHx8IHR5cGVDb2x1bW5cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBhbiBhdXRob3JpemVkIG5lc3RlZCByZWNvcmQgYnkgaWQgd2l0aG91dCBwYXJlbnQgc2NvcGluZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb29rdXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7XCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgZm9yIGVycm9yIG1lc3NhZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQXV0aG9yaXplZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kTmVzdGVkUmVjb3JkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkoe1twcmltYXJ5S2V5XTogaWR9KVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgJHthY3Rpb259IG5lc3RlZCAke3JlbGF0aW9uc2hpcE5hbWV9W2lkPSR7aWR9XTogcmVjb3JkIG5vdCBmb3VuZCBvciBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cblxuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhYmlsaXR5IGFjdGlvbiBmb3IgYSBjaGlsZCByZXNvdXJjZSB1c2luZyB0aGUgY2hpbGQncyBvd25cbiAgICogYGFiaWxpdGllc2AgbWFwcGluZyDigJQgbmV2ZXIgdGhlIHBhcmVudCBjb250cm9sbGVyJ3MuIFRoaXMgcHJlc2VydmVzXG4gICAqIGN1c3RvbSBtYXBwaW5ncyBsaWtlIGB7dXBkYXRlOiBcIm1hbmFnZVwifWAgYW5kIGNhdGNoZXMgdW5tYXBwZWQgYWN0aW9uc1xuICAgKiBpbnN0ZWFkIG9mIHNpbGVudGx5IGRlZmF1bHRpbmcgdG8gdGhlIHJhdyBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFiaWxpdHkgYWN0aW9uIGZvciB0aGUgY2hpbGQgcmVzb3VyY2UuXG4gICAqL1xuICBfcmVzb2x2ZUNoaWxkQWJpbGl0eUFjdGlvbihjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24/LmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGFiaWxpdGllcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFuICdhYmlsaXRpZXMnIG9iamVjdCB0byBhdXRob3JpemUgbmVzdGVkICR7YWN0aW9ufS5gKVxuICAgIH1cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGNoaWxkIHJlc291cmNlIG11c3QgZGVmaW5lIGFiaWxpdGllcy4ke2FjdGlvbn0uYClcbiAgICB9XG5cbiAgICByZXR1cm4gYWJpbGl0eUFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFuIGV4aXN0aW5nIGNoaWxkIGZvciBhIG5lc3RlZCB1cGRhdGUvZGVzdHJveSwgc2NvcGVkIHRvIHRoZVxuICAgKiBjaGlsZCdzIG93biBtb2RlbCBjbGFzcywgdGhlIHBhcmVudCdzIGZvcmVpZ24ga2V5LCBBTkQgdGhlIGNoaWxkXG4gICAqIHJlc291cmNlJ3MgYWJpbGl0eSBtYXBwaW5nIGZvciB0aGUgcmVxdWVzdGVkIGFjdGlvbi4gVGhyb3dzIHdoZW4gdGhlXG4gICAqIGNoaWxkIGRvZXMgbm90IGV4aXN0LCBkb2VzIG5vdCBiZWxvbmcgdG8gdGhlIGN1cnJlbnQgcGFyZW50LCBvciBpc1xuICAgKiBub3QgYXV0aG9yaXplZCDigJQgYWxsIG9mIHdoaWNoIG11c3Qgcm9sbCB0aGUgdHJhbnNhY3Rpb24gYmFjay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gYXJncy5pZCAtIENoaWxkIGlkIGZyb20gdGhlIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlcj59IGFyZ3MucGFyZW50TGlua0F0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCwgcGFyZW50LWxpbmtlZCBjaGlsZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIF9maW5kU2NvcGVkQ2hpbGQoe2FiaWxpdHksIGFjdGlvbiwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGlkLCBwYXJlbnQsIHBhcmVudExpbmtBdHRyaWJ1dGVzLCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGxvb2t1cCA9IHtbcHJpbWFyeUtleV06IGlkLCAuLi5wYXJlbnRMaW5rQXR0cmlidXRlc31cbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHF1ZXJ5LmZpbmRCeShsb29rdXApXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kLCBkb2VzIG5vdCBiZWxvbmcgdG8gcGFyZW50ICR7cGFyZW50LmdldE1vZGVsQ2xhc3MoKS5uYW1lfVtpZD0ke3BhcmVudC5pZCgpfV0sIG9yIGlzIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgYW4gYWxyZWFkeS1zYXZlZCBuZXN0ZWQgY2hpbGQgaXMgYXV0aG9yaXplZCB1bmRlciB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBvd24gYGNyZWF0ZWAgYWJpbGl0eS4gUm9sbHMgYmFjayB2aWEgdGhyb3duIGVycm9yIHdoZW4gbm90XG4gICAqIGF1dGhvcml6ZWQgc28gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGRlc3Ryb3lzIHRoZSBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhcmdzLmFiaWxpdHkgLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuY2hpbGQgLSBDaGlsZCBtb2RlbCBpbnN0YW5jZSBqdXN0IGNyZWF0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBQYXJlbnQncyByZWxhdGlvbnNoaXAgbmFtZSAoZm9yIGVycm9yIG1lc3NhZ2VzKS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe2FiaWxpdHksIGNoaWxkLCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBpZiAoIWFiaWxpdHkpIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIFwiY3JlYXRlXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRhcmdldE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgYXV0aG9yaXplZElkcyA9IGF3YWl0IHRhcmdldE1vZGVsQ2xhc3NcbiAgICAgIC5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24sIGFiaWxpdHkpXG4gICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogY2hpbGQucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5KX0pXG4gICAgICAucGx1Y2socHJpbWFyeUtleSlcblxuICAgIGlmIChhdXRob3JpemVkSWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgY3JlYXRlIG9uICR7cmVsYXRpb25zaGlwTmFtZX1bJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9XSBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBuZXN0ZWQgd3JpdGVzLCBwcmVsb2FkIGV2ZXJ5IHJlbGF0aW9uc2hpcCBkZWNsYXJlZCBpbiB0aGVcbiAgICogcGFyZW50J3MgcGVybWl0IHNvIHRoZSBwb3N0LXNhdmUgc2VyaWFsaXplIHN0ZXAgZW1pdHMgdGhlbSBhbmQgdGhlXG4gICAqIGNsaWVudCBjYW4gcmVjb25jaWxlIGlkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBTYXZlZCBwYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IHBlcm1pdCAtIFBhcnNlZCBwYXJlbnQgcGVybWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lcyA9IE9iamVjdC5rZXlzKHBlcm1pdC5uZXN0ZWQpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZWxhdGlvbnNoaXBOYW1lcykge1xuICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFBhcnNlcyB0aGUgUmFpbHMvYXBpX21ha2VyLXN0eWxlIGZsYXQgcGVybWl0IHNwZWMgcmV0dXJuZWQgZnJvbVxuICogYHBlcm1pdHRlZFBhcmFtcyhhcmcpYCBpbnRvIGEgc3RydWN0dXJlZCBzaGFwZSB1c2VkIGludGVybmFsbHkgYnkgdGhlXG4gKiB3cml0ZSBwaXBlbGluZS4gU3RyaW5ncyBiZWNvbWUgYXR0cmlidXRlIHBlcm1pdHM7IG9iamVjdHMgd2hvc2Uga2V5c1xuICogZW5kIGluIGBBdHRyaWJ1dGVzYCBiZWNvbWUgbmVzdGVkIHBlcm1pdHMgKHRoZSBrZXkgcHJlZml4IG5hbWVzIHRoZVxuICogcmVsYXRpb25zaGlwKS5cbiAqXG4gKiAgIHBhcnNlUGVybWl0dGVkUGFyYW1zKFtcImZpcnN0TmFtZVwiLCBcImxhc3ROYW1lXCIsXG4gKiAgICAge3Rhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gKiAgIF0pXG4gKiAgIC8vIOKGkiB7XG4gKiAgIC8vICAgYXR0cmlidXRlczogW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIl0sXG4gKiAgIC8vICAgbmVzdGVkOiB7XG4gKiAgIC8vICAgICB0YXNrczoge2F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdLCBuZXN0ZWQ6IHt9fVxuICogICAvLyAgIH1cbiAqICAgLy8gfVxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+IHwgdW5kZWZpbmVkfSBwZXJtaXRTcGVjIC0gRmxhdCBwZXJtaXQgc3BlYy5cbiAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fX0gLSBQYXJzZWQgc3RydWN0dXJlLlxuICovXG5mdW5jdGlvbiBwYXJzZVBlcm1pdHRlZFBhcmFtcyhwZXJtaXRTcGVjKSB7XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgY29uc3QgbmVzdGVkID0ge31cblxuICBpZiAoIUFycmF5LmlzQXJyYXkocGVybWl0U3BlYykpIHJldHVybiB7YXR0cmlidXRlcywgbmVzdGVkfVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgcGVybWl0U3BlYykge1xuICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGF0dHJpYnV0ZXMucHVzaChlbnRyeSlcbiAgICB9IGVsc2UgaWYgKGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBuZXN0ZWQgcmVsYXRpb25zaGlwIGtleXMgbXVzdCBlbmQgaW4gXCJBdHRyaWJ1dGVzXCIgKGdvdCBcIiR7a2V5fVwiKS4gVXNlIFwiJHtrZXl9QXR0cmlidXRlc1wiIGluc3RlYWQuYClcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0ga2V5LnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogZW1wdHkgcmVsYXRpb25zaGlwIG5hbWUgaW4ga2V5IFwiJHtrZXl9XCIuYClcbiAgICAgICAgfVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeSBmb3IgXCIke2tleX1cIjogZXhwZWN0ZWQgYXJyYXkgcGVybWl0IHNwZWMsIGdvdCAke3R5cGVvZiB2YWx1ZX0uYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXSA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHZhbHVlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBleHBlY3RlZCBzdHJpbmcgb3IgbmVzdGVkLWF0dHJpYnV0ZXMgb2JqZWN0LCBnb3QgJHt0eXBlb2YgZW50cnl9LmApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG59XG5cbi8qKlxuICogTG9jYXRlcyB3aGljaCBwcm90b3R5cGUgb3ducyBhIG1ldGhvZCBpbXBsZW1lbnRhdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBpbnN0YW5jZSAtIEluc3RhbmNlIHJlY2VpdmluZyB0aGUgbWV0aG9kLlxuICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAqIEByZXR1cm5zIHtvYmplY3QgfCBudWxsfSAtIFByb3RvdHlwZSB0aGF0IG93bnMgdGhlIG1ldGhvZC5cbiAqL1xuZnVuY3Rpb24gcHJvdG90eXBlT3duZXJGb3JNZXRob2QoaW5zdGFuY2UsIG1ldGhvZE5hbWUpIHtcbiAgbGV0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihpbnN0YW5jZSlcblxuICB3aGlsZSAocHJvdG90eXBlKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwcm90b3R5cGUsIG1ldGhvZE5hbWUpKSByZXR1cm4gcHJvdG90eXBlXG5cbiAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZpbHRlciB3cml0YWJsZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlY2VpdmVyIC0gTW9kZWwgaW5zdGFuY2Ugb3IgcHJvdG90eXBlLlxuICogQHBhcmFtIHtXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3N9IHJlY2VpdmVyQ2xhc3MgLSBTdGF0aWMgaGVscGVyIG93bmVyIGZvciB0aGUgcmVjZWl2ZXIuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsfSBbcmVzb3VyY2VdIC0gUmVzb3VyY2UgaW5zdGFuY2UgZm9yIHZpcnR1YWwtc2V0dGVyIGRldGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCBudWxsfSBbcGVybWl0dGVkQXR0cmlidXRlTmFtZXNdIC0gT3B0aW9uYWwgZXhwbGljaXQgcGVybWl0IGxpc3QuIGBudWxsYCBmYWxscyBiYWNrIHRvIHNldHRlci1leGlzdGVuY2UgY2hlY2tzIG9ubHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdyaXRhYmxlIGF0dHJpYnV0ZXMgb25seS5cbiAqL1xuZnVuY3Rpb24gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhcbiAgcmVjZWl2ZXIsXG4gIHJlY2VpdmVyQ2xhc3MsXG4gIGF0dHJpYnV0ZXMsXG4gIHJlc291cmNlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgbnVsbH0gKi8gKG51bGwpLFxuICBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyA9IG51bGxcbikge1xuICAvLyBGcm9udGVuZC1tb2RlbCB3cml0ZXMgc2hvdWxkIGZhaWwgZmFzdCB3aGVuIGNhbGxlcnMgc3VibWl0IHJlYWQtb25seSBvciB1bmtub3duIGF0dHJzLlxuICAvLyBTaWxlbnQgZHJvcHMgaGlkZSBjb250cmFjdCBtaXN0YWtlcyBpbiBnZW5lcmF0ZWQgbW9kZWxzIGFuZCBhcHAtc2lkZSB3cmFwcGVyIGNvZGUuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCB3cml0YWJsZUF0dHJpYnV0ZXMgPSB7fVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMgPSBbXVxuXG4gIGNvbnN0IHBlcm1pdFNldCA9IEFycmF5LmlzQXJyYXkocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpID8gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgOiBudWxsXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGxldCB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgaWYgKHJlc291cmNlKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcblxuICAgIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdXG4gIH1cblxuICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldCh0cmFuc2xhdGVkQXR0cmlidXRlcylcblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAocGVybWl0U2V0ICYmICFwZXJtaXRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gcmVjZWl2ZXJDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB8fCBhdHRyaWJ1dGVOYW1lXG4gICAgY29uc3QgcmVxdWVzdGVkU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHJlY2VpdmVyQ2xhc3MuZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZShyZWNlaXZlciwgcmVxdWVzdGVkU2V0dGVyTmFtZSkgfHwgcmVxdWVzdGVkU2V0dGVyTmFtZVxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9QXR0cmlidXRlYFxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gcmVzb3VyY2U/LnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgIGlmIChzZXR0ZXJOYW1lIGluIHJlY2VpdmVyKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2Uge1xuICAgICAgaW52YWxpZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIGlmIChub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBGcm9udGVuZCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzIG5vdCBwZXJtaXR0ZWQgYnkgcGVybWl0dGVkUGFyYW1zKCk6ICR7bm90UGVybWl0dGVkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgfVxuXG4gIHJldHVybiB3cml0YWJsZUF0dHJpYnV0ZXNcbn1cbiJdfQ==