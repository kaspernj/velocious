// @ts-check
import AuthorizationBaseResource from "../authorization/base-resource.js";
import * as inflection from "inflection";
import isPlainObject from "../utils/plain-object.js";
import { modelPrimaryKeyConditions, readModelPrimaryKeyValue, scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
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
 * @typedef {FrontendModelResourceAttributePayload & {id?: import("../utils/model-primary-key.js").ModelPrimaryKeyValue, _destroy?: boolean, attributes?: FrontendModelResourceAttributePayload, attachments?: FrontendModelResourceAttributePayload, nestedAttributes?: FrontendModelResourceAttributePayload}} FrontendModelResourceNestedEntry
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
    /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
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
        const attachments = this.sharedResourceStaticValue("attachments");
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
        if (attachments)
            config.attachments = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (attachments);
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
    primaryKey() { return this.resourceConfiguration().primaryKey || this.modelClass().primaryKey(); }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1yZXNvdXJjZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHlCQUF5QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3pFLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sYUFBYSxNQUFNLDBCQUEwQixDQUFBO0FBQ3BELE9BQU8sRUFBQyx5QkFBeUIsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsRUFBQyxNQUFNLCtCQUErQixDQUFBO0FBQzdILE9BQU8sY0FBYyxNQUFNLHVCQUF1QixDQUFBO0FBRWxEOzs7R0FHRztBQUVIOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBRUg7OztHQUdHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7OztHQU9HO0FBRUg7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7O0dBV0c7QUFFSDs7O0dBR0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVIOzs7R0FHRztBQUVIOzs7R0FHRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7OztHQU1HO0FBRUg7OztHQUdHO0FBRUg7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBMEIsU0FBUSx5QkFBeUI7SUFDOUUsK0VBQStFO0lBQy9FLE1BQU0sQ0FBQyxVQUFVLEdBQUcsU0FBUyxDQUFBO0lBRTdCLG1GQUFtRjtJQUNuRixNQUFNLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQTtJQUM3QixtQ0FBbUM7SUFDbkMsTUFBTSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUE7SUFDNUIsd0VBQXdFO0lBQ3hFLE1BQU0sQ0FBQyxXQUFXLEdB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QUFDLEdBQUcsS0FBSyxDQUFBO1FBQzNDLENBQUM7YUFBTSxDQUFDO1lBQ04saUJBQWlCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBQ3ZDLENBQUM7SUFDSCxDQUFDO0lBRUQsSUFBSSxzQkFBc0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDdEMsTUFBTSxjQUFjLENBQUMsSUFBSSxDQUFDLHVFQUF1RSxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFDLElBQUksRUFBRSxnQ0FBZ0MsRUFBQyxDQUFDLENBQUE7SUFDakwsQ0FBQztJQUVELElBQUksaUJBQWlCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pDLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyw0Q0FBNEMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFBO0lBQ2pKLENBQUM7SUFFRCxPQUFPLGtCQUFrQixDQUFBO0FBQzNCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgZnJvbSBcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHttb2RlbFByaW1hcnlLZXlDb25kaXRpb25zLCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuXG4vKipcbiAqIEJ1aWx0LWluIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGFjdGlvbi5cbiAqIEB0eXBlZGVmIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9uXG4gKi9cblxuLyoqXG4gKiBGcm9udGVuZC1tb2RlbCBjb250cm9sbGVyIG1ldGhvZHMgdXNlZCBieSByZXNvdXJjZXMuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vY29udHJvbGxlci5qc1wiKS5kZWZhdWx0ICYge1xuICogICBjdXJyZW50QWJpbGl0eTogKCkgPT4gaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFBhZ2luYXRpb246IChhcmdzOiB7cGFnaW5hdGlvbjogRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbiwgcXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0pID0+IHZvaWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFNlYXJjaDogKGFyZ3M6IHtxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LCBzZWFyY2g6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNlYXJjaH0pID0+IHZvaWQsXG4gKiAgIGFwcGx5RnJvbnRlbmRNb2RlbFNvcnQ6IChhcmdzOiB7cXVlcnk6IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Piwgc29ydDogRnJvbnRlbmRNb2RlbFJlc291cmNlU29ydH0pID0+IHZvaWQsXG4gKiAgIGZyb250ZW5kTW9kZWxBYmlsaXR5QWN0aW9uOiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IHN0cmluZyxcbiAqICAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnk6IChhY3Rpb246IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFjdGlvbikgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5OiAoYWN0aW9uOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBY3Rpb24pID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0PixcbiAqICAgZnJvbnRlbmRNb2RlbEluZGV4UXVlcnk6IChvcHRpb25zPzogRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnMgJiB7cmVzb3VyY2U/OiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSkgPT4gaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+LFxuICogICBmcm9udGVuZE1vZGVsUGFyYW1zOiAoKSA9PiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtcyxcbiAqICAgZnJvbnRlbmRNb2RlbFByZWxvYWQ6ICgpID0+IGltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsLFxuICogICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzczogKG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCkgPT4gRnJvbnRlbmRNb2RlbFJlc29sdmVkUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgbnVsbCxcbiAqICAgc2VyaWFsaXplRnJvbnRlbmRNb2RlbDogKG1vZGVsOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBvYmplY3QgfCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbD4+XG4gKiB9fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyXG4gKi9cblxuLyoqXG4gKiBHZW5lcmljIGZyb250ZW5kLW1vZGVsIGluZGV4IHF1ZXJ5IHBhc3NlZCB0byByZXNvdXJjZSBxdWVyeSBob29rcy5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5XG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIGZvciBidWlsZGluZyBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGluZGV4IHF1ZXJ5LlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlSW5kZXhRdWVyeU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2luY2x1ZGVQYWdpbmF0aW9uXSAtIFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgcGFnaW5hdGlvbiBwYXJhbXMgc2hvdWxkIGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlU29ydF0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHNvcnQgcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvblxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBsaW1pdCAtIE1heGltdW0gbnVtYmVyIG9mIHJlY29yZHMuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG9mZnNldCAtIE51bWJlciBvZiByZWNvcmRzIHRvIHNraXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHBhZ2UgLSAxLWJhc2VkIHBhZ2UgbnVtYmVyLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwZXJQYWdlIC0gUGFnZSBzaXplLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNoIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VTZWFyY2hcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gKiBAcHJvcGVydHkge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNvcnRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzb3J0IGJ5LlxuICogQHByb3BlcnR5IHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyQXJnc1xuICogQHByb3BlcnR5IHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSBjb250cm9sbGVyIC0gRnJvbnRlbmQtbW9kZWwgY29udHJvbGxlciBpbnN0YW5jZS5cbiAqIEBwcm9wZXJ0eSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gQmFja2luZyBtb2RlbCBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbiAob3IgcmF3IGlucHV0IHNoYXBlIGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICovXG5cbi8qKlxuICogRnJvbnRlbmRNb2RlbFJlc291cmNlQWJpbGl0eUFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYWJpbGl0eV0gLSBBYmlsaXR5IGluc3RhbmNlIHdoZW4gdGhlIHJlc291cmNlIGlzIHVzZWQgZGlyZWN0bHkgZm9yIGF1dGhvcml6YXRpb24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2NvbmZpZ3VyYXRpb25dIC0gVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb24gZm9yIGNvbnRyb2xsZXItbGVzcyBjb25zdHJ1Y3Rpb24gKGZvciBleGFtcGxlIHRoZSBzeW5jIHdlYnNvY2tldCBjaGFubmVsKTsgdGhlIGNvbnRyb2xsZXIgcGF0aCBkZXJpdmVzIGl0IGZyb20gdGhlIGNvbnRyb2xsZXIgaW5zdGVhZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNMb29zZU9iamVjdH0gW2NvbnRleHRdIC0gQWJpbGl0eSBjb250ZXh0LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c0xvb3NlT2JqZWN0fSBbbG9jYWxzXSAtIEFiaWxpdHkgbG9jYWxzLlxuICogQHByb3BlcnR5IHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFttb2RlbENsYXNzXSAtIE9wdGlvbmFsIGJhY2tpbmcgbW9kZWwgY2xhc3Mgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW21vZGVsTmFtZV0gLSBPcHRpb25hbCBtb2RlbCBuYW1lIG92ZXJyaWRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gW3BhcmFtc10gLSBPcHRpb25hbCBwYXJhbXMgb3ZlcnJpZGUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IFtyZXNvdXJjZUNvbmZpZ3VyYXRpb25dIC0gT3B0aW9uYWwgbm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICovXG5cbi8qKlxuICogTm9ybWFsaXplZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBwYXNzZWQgdG8gdGhlIHJlc291cmNlIHN5bmMgaG9va3MuXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vc3luYy9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gRnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvblxuICovXG5cbi8qKlxuICogU3luYyBtdXRhdGlvbiBhdXRob3JpemF0aW9uIHJlc3VsdC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvblxuICogQHByb3BlcnR5IHtib29sZWFufSBhbGxvd2VkIC0gV2hldGhlciB0aGUgbXV0YXRpb24gbWF5IGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3JlYXNvbl0gLSBTdGFibGUgZmFpbHVyZSByZWFzb24gY29kZSB3aGVuIGRlbmllZC5cbiAqL1xuXG4vKipcbiAqIEFyZ3VtZW50cyBmb3IgdGhlIGFwcGx5U3luYyBmdWxsLWVzY2FwZS1oYXRjaCBob29rLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3NcbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gZXhpc3RpbmdTeW5jIC0gRXhpc3Rpbmcgc3luYyByb3cgb3IgbnVsbC5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAqL1xuXG4vKipcbiAqIEFwcGx5IHJlc3VsdCBwcm9kdWNlZCBieSByb3V0ZWQgc3luYyBtdXRhdGlvbiBhcHBsaWNhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY3JlYXRlZCAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGNyZWF0ZWQuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkZWxldGVkXSAtIFdoZXRoZXIgYSByZWNvcmQgd2FzIGRlbGV0ZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gcmVjb3JkIC0gQXBwbGllZCByZWNvcmQgb3IgbnVsbC5cbiAqL1xuXG4vKipcbiAqIFJlc29sdmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdHJhdGlvbi5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxSZXNvbHZlZFJlc291cmNlQ29uZmlndXJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3Qgb3duaW5nIHRoZSByZXNvdXJjZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gcmVzb3VyY2VDbGFzcyAtIFJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gKi9cblxuLyoqXG4gKiBUcmFuc3BvcnQtc2FmZSB2YWx1ZSBhY2NlcHRlZCBpbiBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbiBwYXlsb2Fkcy5cbiAqIE5lc3RlZCBvYmplY3QvYXJyYXkgdmFsdWVzIGFyZSBpbnRlbnRpb25hbGx5IG9wYXF1ZSBiZWNhdXNlIFR5cGVTY3JpcHQgcmVqZWN0c1xuICogcmVjdXJzaXZlIEpTRG9jIHR5cGVkZWZzIGZvciB0aGlzIHRyYW5zcG9ydCBwYXlsb2FkIGNvbnRyYWN0LlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9iYXNlLmpzXCIpLkZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSB8IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBBcnJheTx1bmtub3duPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlXG4gKi9cblxuLyoqXG4gKiBBdHRyaWJ1dGUgcGF5bG9hZCBhY2NlcHRlZCBieSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZSBtdXRhdGlvbnMuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgRnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlPn0gRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZFxuICovXG5cbi8qKlxuICogVmlydHVhbCBzZXR0ZXIgbWV0aG9kIG9uIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UuXG4gKiBAdHlwZWRlZiB7KGFyZzE6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBhcmcyOiBGcm9udGVuZE1vZGVsUmVzb3VyY2VQYXlsb2FkVmFsdWUpID0+ICh2b2lkIHwgUHJvbWlzZTx2b2lkPil9IEZyb250ZW5kTW9kZWxSZXNvdXJjZVZpcnR1YWxTZXR0ZXJcbiAqL1xuXG4vKipcbiAqIFN0YXRpYyBoZWxwZXJzIHVzZWQgd2hlbiBjaGVja2luZyB3aGV0aGVyIGEgbW9kZWwtbGlrZSByZWNlaXZlciBhY2NlcHRzIGFuIGF0dHJpYnV0ZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFdyaXRhYmxlQXR0cmlidXRlUmVjZWl2ZXJDbGFzc1xuICogQHByb3BlcnR5IHsoYXJnOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IHJlc29sdmVBdHRyaWJ1dGVOYW1lIC0gUmVzb2x2ZXMgYWxpYXNlcyB0byBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWVzLlxuICogQHByb3BlcnR5IHsoYXJnMTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhcmcyOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGx9IGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUgLSBMb2NhdGVzIGEgc2V0dGVyIG1ldGhvZCBvbiB0aGUgcmVjZWl2ZXIuXG4gKi9cblxuLyoqXG4gKiBPcHRpb25zIHBhc3NlZCB3aGlsZSBzYXZpbmcgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgbXV0YXRpb25zLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFJlc291cmNlU2F2ZU9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFthdHRhY2htZW50c10gLSBVcGxvYWRlZCBhdHRhY2htZW50IGF0dHJpYnV0ZXMuXG4gKiBAcHJvcGVydHkge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsfSBbY29udHJvbGxlcl0gLSBDb250cm9sbGVyIGhhbmRsaW5nIHRoZSBtdXRhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCB8IG51bGx9IFtuZXN0ZWRBdHRyaWJ1dGVzXSAtIE5lc3RlZCBhdHRyaWJ1dGVzIHBheWxvYWQuXG4gKi9cblxuLyoqXG4gKiBOb3JtYWxpemVkIG5lc3RlZCBhdHRyaWJ1dGVzIGVudHJ5LlxuICogQHR5cGVkZWYge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgJiB7aWQ/OiBpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZSwgX2Rlc3Ryb3k/OiBib29sZWFuLCBhdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZCwgYXR0YWNobWVudHM/OiBGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkLCBuZXN0ZWRBdHRyaWJ1dGVzPzogRnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH19IEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5XG4gKi9cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBiYWNrZW5kIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBbVE1vZGVsQ2xhc3M9dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0XVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGV4dGVuZHMgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSB7XG4gIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgTW9kZWxDbGFzcyA9IHVuZGVmaW5lZFxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgc3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhYmlsaXRpZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBhdHRhY2htZW50cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgY29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbWVtYmVyQ29tbWFuZHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIGJ1aWx0SW5NZW1iZXJDb21tYW5kcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZyB8IHN0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU2VydmVyQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHNlcnZlciA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luYyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge3N0cmluZ1tdIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgc3RhdGljIFNoYXJlZFJlc291cmNlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIERlY2xhcmF0aXZlIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdCAoY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lcylcbiAgICogdXNlZCBhcyB0aGUgZGVmYXVsdCB7QGxpbmsgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSNwZXJtaXR0ZWRQYXJhbXN9IGFuZFxuICAgKiBhcyB0aGUgcm91dGVkIHN5bmMgcmVwbGF5IHBlcm1pdC4gUmVzb2x2ZWQgdGhyb3VnaCB0aGUgc2hhcmVkIHJlc291cmNlXG4gICAqIGxpa2UgdGhlIG90aGVyIHN0YXRpYyByZXNvdXJjZSBjb25maWc6IGFuIHVuZGVjbGFyZWQgZW52aXJvbm1lbnQgbGlzdFxuICAgKiBmYWxscyBiYWNrIHRvIHRoZSBzaGFyZWQgcmVzb3VyY2UncyBsaXN0LCB3aGlsZSBhbiBleHBsaWNpdCBkZWNsYXJhdGlvblxuICAgKiAoaW5jbHVkaW5nIGBudWxsYCkgd2lucy5cbiAgICogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHdyaXRhYmxlQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFiaWxpdHlBcmdzIHwgRnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlckFyZ3N9IGFyZ3MgLSBSZXNvdXJjZSBhcmdzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncykge1xuICAgIHN1cGVyKHtcbiAgICAgIGFiaWxpdHk6IFwiYWJpbGl0eVwiIGluIGFyZ3MgPyBhcmdzLmFiaWxpdHkgOiB1bmRlZmluZWQsXG4gICAgICBjb250ZXh0OiBcImNvbnRleHRcIiBpbiBhcmdzID8gYXJncy5jb250ZXh0IHx8IHt9IDoge30sXG4gICAgICBsb2NhbHM6IFwibG9jYWxzXCIgaW4gYXJncyA/IGFyZ3MubG9jYWxzIHx8IHt9IDoge31cbiAgICB9KVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gKi8gKHthdHRyaWJ1dGVzOiBbXX0pXG5cbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBcImNvbnRyb2xsZXJcIiBpbiBhcmdzID8gYXJncy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgdGhpcy5jb25maWd1cmF0aW9uVmFsdWUgPSBcImNvbmZpZ3VyYXRpb25cIiBpbiBhcmdzID8gYXJncy5jb25maWd1cmF0aW9uIDogdW5kZWZpbmVkXG4gICAgdGhpcy5tb2RlbENsYXNzVmFsdWUgPSBcIm1vZGVsQ2xhc3NcIiBpbiBhcmdzID8gYXJncy5tb2RlbENsYXNzIDogUmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICB0aGlzLm1vZGVsTmFtZVZhbHVlID0gXCJtb2RlbE5hbWVcIiBpbiBhcmdzID8gYXJncy5tb2RlbE5hbWUgOiB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuICAgIHRoaXMucGFyYW1zVmFsdWUgPSBcInBhcmFtc1wiIGluIGFyZ3MgPyBhcmdzLnBhcmFtcyA6IHVuZGVmaW5lZFxuICAgIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUgPSBcInJlc291cmNlQ29uZmlndXJhdGlvblwiIGluIGFyZ3MgPyBhcmdzLnJlc291cmNlQ29uZmlndXJhdGlvbiA6IGRlZmF1bHRSZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlID0gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY29uZmlndXJlZCBzaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTaGFyZWQgcmVzb3VyY2UgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgc2hhcmVkUmVzb3VyY2VDbGFzcygpIHtcbiAgICByZXR1cm4gdGhpcy5TaGFyZWRSZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgc3RhdGljIHJlc291cmNlIGNvbmZpZyB2YWx1ZSBmcm9tIHRoZSBlbnZpcm9ubWVudCByZXNvdXJjZSBmaXJzdCxcbiAgICogdGhlbiBmcm9tIHRoZSBzaGFyZWQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7XCJhYmlsaXRpZXNcIiB8IFwiYXR0YWNobWVudHNcIiB8IFwiYXR0cmlidXRlc1wiIHwgXCJidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzXCIgfCBcImJ1aWx0SW5NZW1iZXJDb21tYW5kc1wiIHwgXCJjb2xsZWN0aW9uQ29tbWFuZHNcIiB8IFwiY29tbWFuZHNcIiB8IFwibWVtYmVyQ29tbWFuZHNcIiB8IFwibW9kZWxOYW1lXCIgfCBcInByaW1hcnlLZXlcIiB8IFwicmVsYXRpb25zaGlwc1wiIHwgXCJzZXJ2ZXJcIiB8IFwic3luY1wiIHwgXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiIHwgXCJ3cml0YWJsZUF0dHJpYnV0ZXNcIn0gbmFtZSAtIFN0YXRpYyBjb25maWcgcHJvcGVydHkgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJlc29sdmVkIGNvbmZpZyB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKG5hbWUpIHtcbiAgICBpZiAodGhpc1tuYW1lXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdGhpc1tuYW1lXVxuXG4gICAgY29uc3QgU2hhcmVkUmVzb3VyY2UgPSAvKiogQHR5cGUge3R5cGVvZiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgdW5kZWZpbmVkfSAqLyAodGhpcy5zaGFyZWRSZXNvdXJjZUNsYXNzKCkpXG5cbiAgICBpZiAoIVNoYXJlZFJlc291cmNlKSByZXR1cm4gdW5kZWZpbmVkXG4gICAgaWYgKFNoYXJlZFJlc291cmNlW25hbWVdICE9PSB1bmRlZmluZWQpIHJldHVybiBTaGFyZWRSZXNvdXJjZVtuYW1lXVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRyYW5zbGF0ZWQgYXR0cmlidXRlcyBmcm9tIGVudmlyb25tZW50IGFuZCBzaGFyZWQgcmVzb3VyY2VzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9IC0gVHJhbnNsYXRlZCBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB7XG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nW10gfCB1bmRlZmluZWR9ICovICh0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJ0cmFuc2xhdGVkQXR0cmlidXRlc1wiKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSByZXNvdXJjZSBpbnN0YW5jZSBmb3Igc2hhcmVkLXJlc291cmNlIGZhbGxiYWNrIGNhbGxzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IG51bGx9IC0gU2hhcmVkIHJlc291cmNlIGluc3RhbmNlIHdoZW4gY29uZmlndXJlZC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlSW5zdGFuY2UoKSB7XG4gICAgaWYgKHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IFNoYXJlZFJlc291cmNlID0gLyoqIEB0eXBlIHt0eXBlb2YgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VDbGFzcygpKVxuXG4gICAgaWYgKCFTaGFyZWRSZXNvdXJjZSkge1xuICAgICAgdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWUgPSBudWxsXG4gICAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZUluc3RhbmNlVmFsdWVcbiAgICB9XG5cbiAgICBpZiAoU2hhcmVkUmVzb3VyY2UgPT09IFJlc291cmNlQ2xhc3MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtSZXNvdXJjZUNsYXNzLm5hbWV9LlNoYXJlZFJlc291cmNlIGNhbm5vdCBwb2ludCB0byBpdHNlbGYuYClcbiAgICB9XG5cbiAgICB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2VWYWx1ZSA9IG5ldyBTaGFyZWRSZXNvdXJjZSh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmFiaWxpdHksXG4gICAgICBjb250cm9sbGVyOiB0aGlzLmNvbnRyb2xsZXIsXG4gICAgICBjb250ZXh0OiB0aGlzLmNvbnRleHQsXG4gICAgICBsb2NhbHM6IHRoaXMubG9jYWxzLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5tb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IHRoaXMubW9kZWxOYW1lKCksXG4gICAgICBwYXJhbXM6IHRoaXMucGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VJbnN0YW5jZVZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2FsbHMgYSBzaGFyZWQtcmVzb3VyY2UgbWV0aG9kIG9ubHkgd2hlbiB0aGUgc2hhcmVkIHJlc291cmNlIG92ZXJyaWRlcyB0aGUgZnJhbWV3b3JrIGRlZmF1bHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gTWV0aG9kIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHBhcmFtIHt1bmtub3duW119IGFyZ3MgLSBNZXRob2QgYXJncy5cbiAgICogQHJldHVybnMge3tjYWxsZWQ6IGJvb2xlYW4sIHJlc3VsdDogdW5rbm93bn19IC0gU2hhcmVkIG1ldGhvZCBjYWxsIHJlc3VsdC5cbiAgICovXG4gIGNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKSB7XG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIHtjYWxsZWQ6IGZhbHNlLCByZXN1bHQ6IHVuZGVmaW5lZH1cblxuICAgIGNvbnN0IG1ldGhvZE93bmVyID0gcHJvdG90eXBlT3duZXJGb3JNZXRob2Qoc2hhcmVkUmVzb3VyY2UsIG1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIW1ldGhvZE93bmVyIHx8IG1ldGhvZE93bmVyID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZSB8fCBtZXRob2RPd25lciA9PT0gQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZS5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybiB7Y2FsbGVkOiBmYWxzZSwgcmVzdWx0OiB1bmRlZmluZWR9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHNoYXJlZFJlc291cmNlKSlbbWV0aG9kTmFtZV1cblxuICAgIHJldHVybiB7Y2FsbGVkOiB0cnVlLCByZXN1bHQ6IG1ldGhvZC5hcHBseShzaGFyZWRSZXNvdXJjZSwgYXJncyl9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaGFyZWQgbWV0aG9kIHJlc3VsdCBvciBhIGZhbGxiYWNrIGNhbGxiYWNrLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRob2ROYW1lIC0gU2hhcmVkIG1ldGhvZCBuYW1lLlxuICAgKiBAcGFyYW0ge3Vua25vd25bXX0gYXJncyAtIFNoYXJlZCBtZXRob2QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBSZXN1bHR9IGZhbGxiYWNrIC0gRmFsbGJhY2sgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtSZXN1bHR9IC0gU2hhcmVkIG9yIGZhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHNoYXJlZFJlc291cmNlTWV0aG9kT3IobWV0aG9kTmFtZSwgYXJncywgZmFsbGJhY2spIHtcbiAgICBjb25zdCBzaGFyZWRSZXN1bHQgPSB0aGlzLmNhbGxTaGFyZWRSZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lLCBhcmdzKVxuXG4gICAgaWYgKHNoYXJlZFJlc3VsdC5jYWxsZWQpIHJldHVybiAvKiogQHR5cGUge1Jlc3VsdH0gKi8gKHNoYXJlZFJlc3VsdC5yZXN1bHQpXG5cbiAgICByZXR1cm4gZmFsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgbWV0aG9kIG9uIHRoaXMgcmVzb3VyY2Ugb3IgaXRzIHNoYXJlZCBmYWxsYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ttZXRob2Q6ICguLi5tZXRob2RBcmdzOiB1bmtub3duW10pID0+IHVua25vd24sIHJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlfSB8IG51bGx9IC0gUmVzb2x2ZWQgbWV0aG9kIGFuZCByZWNlaXZlci5cbiAgICovXG4gIHJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUpIHtcbiAgICBjb25zdCBvd25NZXRob2QgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAodGhpcykpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIG93bk1ldGhvZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBtZXRob2Q6IC8qKiBAdHlwZSB7KC4uLm1ldGhvZEFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bn0gKi8gKG93bk1ldGhvZCksXG4gICAgICAgIHJlc291cmNlOiB0aGlzXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2hhcmVkUmVzb3VyY2UgPSB0aGlzLnNoYXJlZFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKCFzaGFyZWRSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNoYXJlZE1ldGhvZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzaGFyZWRSZXNvdXJjZSkpW21ldGhvZE5hbWVdXG5cbiAgICBpZiAodHlwZW9mIHNoYXJlZE1ldGhvZCAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGhvZDogLyoqIEB0eXBlIHsoLi4ubWV0aG9kQXJnczogdW5rbm93bltdKSA9PiB1bmtub3dufSAqLyAoc2hhcmVkTWV0aG9kKSxcbiAgICAgIHJlc291cmNlOiBzaGFyZWRSZXNvdXJjZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFiaWxpdGllcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYWJpbGl0aWVzKCkge1xuICAgIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFiaWxpdGllc1wiLCBbXSwgKCkgPT4gdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHlwZWQgY29udHJvbGxlciBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IC0gQ29udHJvbGxlciBpbnN0YW5jZSB3aXRoIGZyb250ZW5kLW1vZGVsIGhlbHBlcnMuXG4gICAqL1xuICB0eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyfSAqLyAodGhpcy5jb250cm9sbGVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb3VyY2UgY29uZmlnLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSAtIFN0YXRpYyByZXNvdXJjZSBjb25maWcgKHJhdyB1c2VyIGlucHV0IHNoYXBlOyBjb25zdW1lcnMgbm9ybWFsaXplKS5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUNvbmZpZygpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0cmlidXRlc1wiKVxuICAgIGNvbnN0IGFiaWxpdGllcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImFiaWxpdGllc1wiKVxuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwiYXR0YWNobWVudHNcIilcbiAgICBjb25zdCBjb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImNvbW1hbmRzXCIpXG4gICAgY29uc3QgYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcImJ1aWx0SW5Db2xsZWN0aW9uQ29tbWFuZHNcIilcbiAgICBjb25zdCBidWlsdEluTWVtYmVyQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJidWlsdEluTWVtYmVyQ29tbWFuZHNcIilcbiAgICBjb25zdCBjb2xsZWN0aW9uQ29tbWFuZHMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJjb2xsZWN0aW9uQ29tbWFuZHNcIilcbiAgICBjb25zdCBtZW1iZXJDb21tYW5kcyA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIm1lbWJlckNvbW1hbmRzXCIpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwibW9kZWxOYW1lXCIpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInByaW1hcnlLZXlcIilcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gdGhpcy5zaGFyZWRSZXNvdXJjZVN0YXRpY1ZhbHVlKFwicmVsYXRpb25zaGlwc1wiKVxuICAgIGNvbnN0IHNlcnZlciA9IHRoaXMuc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcInNlcnZlclwiKVxuICAgIGNvbnN0IHN5bmMgPSB0aGlzLnNoYXJlZFJlc291cmNlU3RhdGljVmFsdWUoXCJzeW5jXCIpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259ICovXG4gICAgY29uc3QgY29uZmlnID0ge1xuICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBzdHJpbmdbXX0gKi8gKGF0dHJpYnV0ZXMgfHwgW10pXG4gICAgfVxuXG4gICAgaWYgKGFiaWxpdGllcykgY29uZmlnLmFiaWxpdGllcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChhYmlsaXRpZXMpXG4gICAgaWYgKGF0dGFjaG1lbnRzKSBjb25maWcuYXR0YWNobWVudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGF0dGFjaG1lbnRzKVxuICAgIGlmIChjb21tYW5kcykgY29uZmlnLmNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKGNvbW1hbmRzKVxuICAgIGlmIChidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzKSBjb25maWcuYnVpbHRJbkNvbGxlY3Rpb25Db21tYW5kcyA9IC8qKiBAdHlwZSB7c3RyaW5nW119ICovIChidWlsdEluQ29sbGVjdGlvbkNvbW1hbmRzKVxuICAgIGlmIChidWlsdEluTWVtYmVyQ29tbWFuZHMpIGNvbmZpZy5idWlsdEluTWVtYmVyQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoYnVpbHRJbk1lbWJlckNvbW1hbmRzKVxuICAgIGlmIChjb2xsZWN0aW9uQ29tbWFuZHMpIGNvbmZpZy5jb2xsZWN0aW9uQ29tbWFuZHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAoY29sbGVjdGlvbkNvbW1hbmRzKVxuICAgIGlmIChtZW1iZXJDb21tYW5kcykgY29uZmlnLm1lbWJlckNvbW1hbmRzID0gLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi8gKG1lbWJlckNvbW1hbmRzKVxuICAgIGlmIChtb2RlbE5hbWUpIGNvbmZpZy5tb2RlbE5hbWUgPSAvKiogQHR5cGUge3N0cmluZ30gKi8gKG1vZGVsTmFtZSlcbiAgICBpZiAocHJpbWFyeUtleSkgY29uZmlnLnByaW1hcnlLZXkgPSAvKiogQHR5cGUge3N0cmluZyB8IHN0cmluZ1tdfSAqLyAocHJpbWFyeUtleSlcbiAgICBpZiAocmVsYXRpb25zaGlwcykgY29uZmlnLnJlbGF0aW9uc2hpcHMgPSAvKiogQHR5cGUge3N0cmluZ1tdfSAqLyAocmVsYXRpb25zaGlwcylcbiAgICBpZiAoc2VydmVyKSBjb25maWcuc2VydmVyID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZVNlcnZlckNvbmZpZ3VyYXRpb259ICovIChzZXJ2ZXIpXG4gICAgaWYgKHN5bmMgIT09IHVuZGVmaW5lZCkgY29uZmlnLnN5bmMgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24gfCBib29sZWFufSAqLyAoc3luYylcblxuICAgIHJldHVybiBjb25maWdcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXRpYyBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIG1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLk1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IHJlcXVpcmVzIGEgc3RhdGljIE1vZGVsQ2xhc3MuYClcblxuICAgIHJldHVybiB0aGlzLk1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnRyb2xsZXIgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb250cm9sbGVyLmpzXCIpLmRlZmF1bHR9IC0gQ29udHJvbGxlciBpbnN0YW5jZS5cbiAgICovXG4gIGNvbnRyb2xsZXJJbnN0YW5jZSgpIHtcbiAgICBpZiAoIXRoaXMuY29udHJvbGxlcikgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBjb250cm9sbGVyIGluc3RhbmNlLmApXG5cbiAgICByZXR1cm4gdGhpcy5jb250cm9sbGVyXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb246IHRoZSBjb250cm9sbGVyJ3Mgd2hlbiB0aGUgcmVzb3VyY2VcbiAgICogc2VydmVzIGEgY29udHJvbGxlciByZXF1ZXN0LCBvdGhlcndpc2UgdGhlIGNvbnN0cnVjdG9yLWluamVjdGVkXG4gICAqIGNvbmZpZ3VyYXRpb24gKGZvciBleGFtcGxlIGEgc3luYyB3ZWJzb2NrZXQgY2hhbm5lbCdzIHJlc291cmNlKS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBWZWxvY2lvdXMgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGNvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udHJvbGxlcikgcmV0dXJuIHRoaXMuY29udHJvbGxlckluc3RhbmNlKCkuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgaWYgKHRoaXMuY29uZmlndXJhdGlvblZhbHVlKSByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uVmFsdWVcblxuICAgIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IHJlcXVpcmVzIGEgY29udHJvbGxlciBvciBhbiBpbmplY3RlZCBjb25maWd1cmF0aW9uLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1RNb2RlbENsYXNzfSAtIE1vZGVsIGNsYXNzLlxuICAgKi9cbiAgbW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxDbGFzc1ZhbHVlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSByZXF1aXJlcyBhIG1vZGVsIGNsYXNzLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7VE1vZGVsQ2xhc3N9ICovICh0aGlzLm1vZGVsQ2xhc3NWYWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmVkIG1vZGVsIGNsYXNzIGZvciBhdXRob3JpemF0aW9uIGhlbHBlcnMuXG4gICAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gLSBCYWNraW5nIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgcmVxdWlyZWRNb2RlbENsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGVsQ2xhc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNb2RlbCBuYW1lLlxuICAgKi9cbiAgbW9kZWxOYW1lKCkge1xuICAgIGlmICghdGhpcy5tb2RlbE5hbWVWYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSBtb2RlbCBuYW1lLmApXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbE5hbWVWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYXJhbXN9IC0gUGFyYW1zLlxuICAgKi9cbiAgcGFyYW1zKCkgeyByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhcmFtc30gKi8gKHRoaXMucGFyYW1zVmFsdWUgfHwgc3VwZXIucGFyYW1zKCkgfHwge30pIH1cblxuICAvKipcbiAgICogUnVucyByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gLSBSZXNvdXJjZSBjb25maWcgKG5vcm1hbGl6ZWQgYXQgcnVudGltZTsgcmF3IGR1cmluZyBlYXJseSBib290c3RyYXApLlxuICAgKi9cbiAgcmVzb3VyY2VDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZSkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0gcmVxdWlyZXMgYSByZXNvdXJjZSBjb25maWd1cmF0aW9uLmApXG5cbiAgICByZXR1cm4gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBSYWlscy1zdHJvbmctcGFyYW1zIC8gYXBpX21ha2VyLXN0eWxlIHBlcm1pdCBzcGVjIGRlY2xhcmluZ1xuICAgKiB3aGljaCBhdHRyaWJ1dGVzIGFuZCBuZXN0ZWQgYXR0cmlidXRlcyBhcmUgd3JpdGFibGUgZm9yIHRoZSBjdXJyZW50XG4gICAqIHJlcXVlc3QuIFN1Ym1pdHRpbmcgYW4gYXR0cmlidXRlIG9yIG5lc3RlZC1yZWxhdGlvbnNoaXAga2V5IHRoYXQgaXNcbiAgICogbm90IHBlcm1pdHRlZCByYWlzZXMgYW4gZXJyb3IgYW5kIGZhaWxzIHRoZSB3cml0ZS5cbiAgICpcbiAgICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgZmxhdCBhcnJheSB0aGF0IG1peGVzOlxuICAgKiAgIC0gYFwiYXR0cmlidXRlTmFtZVwiYCBzdHJpbmdzIGZvciBwbGFpbiBhdHRyaWJ1dGUgd3JpdGVzXG4gICAqICAgLSBgezxyZWxhdGlvbnNoaXBOYW1lPkF0dHJpYnV0ZXM6IFsuLi5dfWAgb2JqZWN0cyB3aGVyZSB0aGUgdmFsdWVcbiAgICogICAgIGlzIGl0c2VsZiBhIHBlcm1pdCBzcGVjIGZvciB0aGUgbmVzdGVkIHJlbGF0aW9uc2hpcFxuICAgKlxuICAgKiBUaGlzIG1hdGNoZXMgUmFpbHMgc3Ryb25nX3BhcmFtcyAoYHBlcm1pdCg6Zmlyc3RfbmFtZSwgOmxhc3RfbmFtZSxcbiAgICogY29udGFjdF9hdHRyaWJ1dGVzOiBbOmVtYWlsLCBkZXRhaWxzX2F0dHJpYnV0ZXM6IFs6ZGV0YWlsXV0pYCkgYW5kXG4gICAqIHRoZSBhcGlfbWFrZXIgc2lzdGVyIHByb2plY3QuIEluY2x1ZGUgYFwiX2Rlc3Ryb3lcImAgaW5zaWRlIGEgbmVzdGVkXG4gICAqIHBlcm1pdCB0byBhbGxvdyBgX2Rlc3Ryb3k6IHRydWVgIGVudHJpZXMgZm9yIHRoYXQgcmVsYXRpb25zaGlwIOKAlFxuICAgKiB0aGUgbW9kZWwgbXVzdCBhbHNvIGRlY2xhcmUgYGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUsXG4gICAqIHthbGxvd0Rlc3Ryb3k6IHRydWV9KWAgZm9yIHRoZSBkZXN0cm95IHRvIGJlIGFwcGxpZWQuXG4gICAqXG4gICAqIEV4YW1wbGU6XG4gICAqXG4gICAqICAgY2xhc3MgUHJvamVjdFJlc291cmNlIGV4dGVuZHMgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSB7XG4gICAqICAgICBwZXJtaXR0ZWRQYXJhbXMoYXJnKSB7XG4gICAqICAgICAgIHJldHVybiBbXG4gICAqICAgICAgICAgXCJuYW1lXCIsXG4gICAqICAgICAgICAgXCJkZXNjcmlwdGlvblwiLFxuICAgKiAgICAgICAgIHt0YXNrc0F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCIsXG4gICAqICAgICAgICAgICB7c3VidGFza3NBdHRyaWJ1dGVzOiBbXCJpZFwiLCBcIl9kZXN0cm95XCIsIFwibmFtZVwiXX1cbiAgICogICAgICAgICBdfVxuICAgKiAgICAgICBdXG4gICAqICAgICB9XG4gICAqICAgfVxuICAgKlxuICAgKiBEZWZhdWx0IGltcGxlbWVudGF0aW9uIHJldHVybnMgdGhlIGRlY2xhcmVkXG4gICAqIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLndyaXRhYmxlQXR0cmlidXRlc30gcGVybWl0IGxpc3QsIG9yIGBbXWBcbiAgICog4oCUIG5vdGhpbmcgcGVybWl0dGVkIOKAlCB3aXRob3V0IGEgZGVjbGFyZWQgbGlzdC4gU3ViY2xhc3NlcyBvdmVycmlkZSB0b1xuICAgKiBjdXN0b21pemU7IGFuIGV4cGxpY2l0IG92ZXJyaWRlIGFsd2F5cyB3aW5zLlxuICAgKiBAcGFyYW0ge3thY3Rpb24/OiBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiwgcGFyYW1zPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhYmlsaXR5PzogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQsIGxvY2Fscz86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmddIC0gUmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQZXJtaXQgc3BlYy5cbiAgICovXG4gIHBlcm1pdHRlZFBhcmFtcyhhcmcpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwicGVybWl0dGVkUGFyYW1zXCIsIFthcmddLCAoKSA9PiB7XG4gICAgICB2b2lkIGFyZ1xuXG4gICAgICByZXR1cm4gdGhpcy5kZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpID8/IFtdXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZGVjbGFyZWQgd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0IGZyb20gdGhlIGVudmlyb25tZW50XG4gICAqIHJlc291cmNlIGZpcnN0LCB0aGVuIHRoZSBzaGFyZWQgcmVzb3VyY2Ug4oCUIG1pcnJvcmluZyBob3cgdGhlIG90aGVyXG4gICAqIHN0YXRpYyByZXNvdXJjZSBjb25maWcgcmVzb2x2ZXMuIEFuIGV4cGxpY2l0IGVudmlyb25tZW50IGRlY2xhcmF0aW9uXG4gICAqIChpbmNsdWRpbmcgYG51bGxgKSB3aW5zIG92ZXIgdGhlIHNoYXJlZCByZXNvdXJjZSdzIGxpc3QuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IERlY2xhcmVkIHBlcm1pdCBsaXN0IG9yIG51bGwgd2hlbiB1bmRlY2xhcmVkLlxuICAgKi9cbiAgZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHBlcm1pdHRlZEF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge3N0cmluZ1tdIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKFJlc291cmNlQ2xhc3Muc2hhcmVkUmVzb3VyY2VTdGF0aWNWYWx1ZShcIndyaXRhYmxlQXR0cmlidXRlc1wiKSlcblxuICAgIHJldHVybiBwZXJtaXR0ZWRBdHRyaWJ1dGVzID8/IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGNsaWVudC1zYWZlIGVycm9yIHRocm93biBmb3IgYSBmYWlsZWQgd3JpdGFibGUtYXR0cmlidXRlIHZhbGlkYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gSHVtYW4tcmVhZGFibGUgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3tjYXVzZT86IEVycm9yLCBjb2RlOiBzdHJpbmd9fSBkZXRhaWxzIC0gU3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgY29kZSBhbmQgb3B0aW9uYWwgY2F1c2UuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gQ2xpZW50LXNhZmUgZXJyb3IuXG4gICAqL1xuICB3cml0YWJsZUF0dHJpYnV0ZUVycm9yKG1lc3NhZ2UsIHtjYXVzZSwgY29kZX0pIHtcbiAgICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShtZXNzYWdlLCBjYXVzZSA/IHtjYXVzZSwgY29kZX0gOiB7Y29kZX0pXG4gIH1cblxuICAvKipcbiAgICogQXV0aG9yaXplcyBvbmUgcm91dGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIGJlZm9yZSBpdCBpcyBhcHBsaWVkLlxuICAgKiBEZWZhdWx0cyB0byBhbGxvd2luZyBldmVyeSBtdXRhdGlvbjsgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24gc3RpbGxcbiAgICogYXBwbGllcyB0aHJvdWdoIHtAbGluayBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlI2ZpbmRTeW5jUmVjb3JkfSBzY29waW5nXG4gICAqIGFuZCB0aGUgY3JlYXRlIG1lbWJlcnNoaXAgY2hlY2suXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTeW5jQXV0aG9yaXphdGlvbiB8IFByb21pc2U8RnJvbnRlbmRNb2RlbFN5bmNBdXRob3JpemF0aW9uPn0gQXV0aG9yaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhdXRob3JpemVTeW5jTXV0YXRpb24oe2NvbnRleHQsIG11dGF0aW9ufSkge1xuICAgIHZvaWQgY29udGV4dFxuICAgIHZvaWQgbXV0YXRpb25cblxuICAgIHJldHVybiB7YWxsb3dlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBwZXItc3luYyBmYWlsdXJlIHJlYXNvbiByZXBvcnRlZCB3aGVuIGEgcm91dGVkIHN5bmMgbXV0YXRpb25cbiAgICogZmFpbHMgcmVjb3JkLWxldmVsIGF1dGhvcml6YXRpb24uIERlZmF1bHRzIHRvIG51bGwsIHdoaWNoIHJlcG9ydHMgdGhlXG4gICAqIGdlbmVyaWMgXCJhY2Nlc3MtZGVuaWVkXCIgcmVhc29uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJ1cGRhdGVcIn0gYXJncy5hY3Rpb24gLSBEZW5pZWQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IFN0YWJsZSBmYWlsdXJlIHJlYXNvbiBjb2RlIG9yIG51bGwgZm9yIHRoZSBnZW5lcmljIGRlZmF1bHQuXG4gICAqL1xuICBzeW5jQXV0aG9yaXphdGlvbkZhaWx1cmVSZWFzb24oe2FjdGlvbiwgbXV0YXRpb259KSB7XG4gICAgdm9pZCBhY3Rpb25cbiAgICB2b2lkIG11dGF0aW9uXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBleGlzdGluZyByZWNvcmQgdGFyZ2V0ZWQgYnkgYSByb3V0ZWQgc3luYyByZXBsYXkgbXV0YXRpb24uXG4gICAqIERlZmF1bHRzIHRvIGFuIGBhY2Nlc3NpYmxlRm9yYCBsb29rdXAgYnkgcHJpbWFyeSBrZXkgdGhyb3VnaCB0aGVcbiAgICogcmVzb3VyY2UncyBub3JtYWxpemVkIGFiaWxpdHkgYWN0aW9uIGZvciB1cGRhdGUgKG9yIGRlc3Ryb3kgZm9yIGRlbGV0ZVxuICAgKiBtdXRhdGlvbnMpLCBmYWxsaW5nIGJhY2sgdG8gYW4gdW5zY29wZWQgbG9va3VwIHdpdGhvdXQgYW4gYWJpbGl0eS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYXJncy5hYmlsaXR5XSAtIEFiaWxpdHkgb3ZlcnJpZGUuIERlZmF1bHRzIHRvIHRoZSByZXNvdXJjZSBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmZvckRlbGV0ZV0gLSBXaGV0aGVyIHRoZSBsb29rdXAgaXMgZm9yIGEgZGVsZXRlIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gRXhpc3RpbmcgcmVjb3JkIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBmaW5kU3luY1JlY29yZCh7YWJpbGl0eSA9IHRoaXMuYWJpbGl0eSwgZm9yRGVsZXRlID0gZmFsc2UsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSB0aGlzLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gYWJpbGl0eVxuICAgICAgPyBNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IodGhpcy5zeW5jQWJpbGl0eUFjdGlvbihmb3JEZWxldGUgPyBcImRlc3Ryb3lcIiA6IFwidXBkYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgOiBNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHRoaXMucHJpbWFyeUtleSgpLCBtdXRhdGlvbi5yZXNvdXJjZUlkKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgcmF3IHN5bmMgYWN0aW9uIHRvIHRoZSByZXNvdXJjZSdzIG5vcm1hbGl6ZWQgYWJpbGl0eSBhY3Rpb24gd2hlblxuICAgKiB0aGUgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBkZWNsYXJlcyBhbiBhYmlsaXRpZXMgbWFwcGluZywgb3RoZXJ3aXNlIHRoZVxuICAgKiByYXcgYWN0aW9uIG5hbWUgaXMgdXNlZCBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcInVwZGF0ZVwifSBhY3Rpb24gLSBSYXcgc3luYyBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEFiaWxpdHkgYWN0aW9uLlxuICAgKi9cbiAgc3luY0FiaWxpdHlBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0aWVzID0gdGhpcy5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZT8uYWJpbGl0aWVzXG5cbiAgICBpZiAoYWJpbGl0aWVzICYmIHR5cGVvZiBhYmlsaXRpZXMgPT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShhYmlsaXRpZXMpKSB7XG4gICAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChhYmlsaXRpZXMpW2FjdGlvbl1cblxuICAgICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uID09IFwic3RyaW5nXCIgJiYgYWJpbGl0eUFjdGlvbi5sZW5ndGggPiAwKSByZXR1cm4gYWJpbGl0eUFjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBhY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBGdWxsIGVzY2FwZSBoYXRjaCBmb3Igcm91dGVkIHN5bmMgbXV0YXRpb24gYXBwbGljYXRpb24uIFJldHVybmluZyBhXG4gICAqIG5vbi1udWxsIHJlc3VsdCByZXBsYWNlcyB0aGUgd2hvbGUgZGVmYXVsdCBhcHBseSBmbG93IChhdXRob3JpemF0aW9uLFxuICAgKiByZWNvcmQgbG9va3VwLCBub3JtYWxpemF0aW9uIGFuZCBzYXZlKSB3aXRoIHRoZSByZXR1cm5lZCBhcHBseSByZXN1bHQuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEFwcGx5U3luY0FyZ3N9IGFyZ3MgLSBBcHBseSBhcmdzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFN5bmNBcHBseVJlc3VsdCB8IG51bGwgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxTeW5jQXBwbHlSZXN1bHQgfCBudWxsPn0gQXBwbHkgcmVzdWx0IG9yIG51bGwgZm9yIHRoZSBkZWZhdWx0IGZsb3cuXG4gICAqL1xuICBhcHBseVN5bmMoYXJncykge1xuICAgIHZvaWQgYXJnc1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGEgcm91dGVkIHN5bmMgbXV0YXRpb24gd2FzIGFwcGxpZWQuIFJldHVybmVkIGVudHJpZXMgYXJlXG4gICAqIG1lcmdlZCBpbnRvIHRoZSBhcHBseSByZXN1bHQsIHJlYWNoaW5nIHBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgYW5kXG4gICAqIGJyb2FkY2FzdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuY3JlYXRlZCAtIFdoZXRoZXIgdGhlIHJlY29yZCB3YXMgY3JlYXRlZC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBhcmdzLnJlY29yZCAtIEFwcGxpZWQgcmVjb3JkIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEV4dHJhIGFwcGx5LXJlc3VsdCBlbnRyaWVzLlxuICAgKi9cbiAgYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQsIG11dGF0aW9uLCByZWNvcmR9KSB7XG4gICAgdm9pZCBjb250ZXh0XG4gICAgdm9pZCBjcmVhdGVkXG4gICAgdm9pZCBtdXRhdGlvblxuICAgIHZvaWQgcmVjb3JkXG5cbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGNyZWF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZUNyZWF0ZUF0dHJpYnV0ZXMoYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzXCIsIFthdHRyaWJ1dGVzLCBvcHRpb25zXSwgKCkgPT4ge1xuICAgICAgdm9pZCBvcHRpb25zXG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHVwZGF0ZSBhdHRyaWJ1dGVzIGJlZm9yZSBwZXJtaXNzaW9uIGZpbHRlcmluZyBhbmQgc2F2aW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBJbmNvbWluZyB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQgfCBQcm9taXNlPEZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWQ+fSAtIE5vcm1hbGl6ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIG5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwibm9ybWFsaXplVXBkYXRlQXR0cmlidXRlc1wiLCBbbW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnNdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgICB2b2lkIG9wdGlvbnNcblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBOZXcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCBjcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVDcmVhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGNyZWF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBDcmVhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIGNyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyQ3JlYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyQ3JlYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB1cGRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRXhpc3RpbmcgbW9kZWwgYmVmb3JlIGFzc2lnbm1lbnQvc2F2ZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBhdHRyaWJ1dGVzIC0gTm9ybWFsaXplZCB1cGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gb3B0aW9ucyAtIFNhdmUgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWQgfCBQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGhvb2sgZmluaXNoZXMuXG4gICAqL1xuICBiZWZvcmVVcGRhdGUobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBVcGRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBOb3JtYWxpemVkIHVwZGF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBvcHRpb25zIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyVXBkYXRlKG1vZGVsLCBhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImFmdGVyVXBkYXRlXCIsIFttb2RlbCwgYXR0cmlidXRlcywgb3B0aW9uc10sICgpID0+IHtcbiAgICAgIHZvaWQgbW9kZWxcbiAgICAgIHZvaWQgYXR0cmlidXRlc1xuICAgICAgdm9pZCBvcHRpb25zXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGJlZm9yZURlc3Ryb3kobW9kZWwpIHtcbiAgICByZXR1cm4gdGhpcy5zaGFyZWRSZXNvdXJjZU1ldGhvZE9yKFwiYmVmb3JlRGVzdHJveVwiLCBbbW9kZWxdLCAoKSA9PiB7XG4gICAgICB2b2lkIG1vZGVsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRGVzdHJveWVkIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZCB8IFByb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgaG9vayBmaW5pc2hlcy5cbiAgICovXG4gIGFmdGVyRGVzdHJveShtb2RlbCkge1xuICAgIHJldHVybiB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJhZnRlckRlc3Ryb3lcIiwgW21vZGVsXSwgKCkgPT4ge1xuICAgICAgdm9pZCBtb2RlbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV3JhcHMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IHJlc291cmNlIG11dGF0aW9ucy5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFRyYW5zYWN0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBNdXRhdGlvbiBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWwgLSBNdXRhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmVzdWx0Pn0gYXJncy5jYWxsYmFjayAtIE11dGF0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXN1bHQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe2FjdGlvbiwgbW9kZWwsIGNhbGxiYWNrfSkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnNoYXJlZFJlc291cmNlTWV0aG9kT3IoXCJydW5NdXRhdGlvblRyYW5zYWN0aW9uXCIsIFt7YWN0aW9uLCBtb2RlbCwgY2FsbGJhY2t9XSwgYXN5bmMgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cbiAgICAgIHZvaWQgbW9kZWxcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIFByaW1hcnkga2V5LlxuICAgKi9cbiAgcHJpbWFyeUtleSgpIHsgcmV0dXJuIHRoaXMucmVzb3VyY2VDb25maWd1cmF0aW9uKCkucHJpbWFyeUtleSB8fCB0aGlzLm1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQWN0aW9ufSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1vZGVsQ2xhc3M+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBhdXRob3JpemVkUXVlcnkoYWN0aW9uKSB7XG4gICAgLy8gTmFycm93cyB0aGUgY29udHJvbGxlciBxdWVyeSB0byB0aGlzIHJlc291cmNlJ3MgbW9kZWwgY2xhc3MuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxUTW9kZWxDbGFzcz59ICovICh0aGlzLnR5cGVkQ29udHJvbGxlckluc3RhbmNlKCkuZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnkoYWN0aW9uKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluZGV4IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBRdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxUTW9kZWxDbGFzcz59IC0gRnJvbnRlbmQtbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqL1xuICBpbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8VE1vZGVsQ2xhc3M+fSAqLyAodGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5KHtcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICByZXNvdXJjZTogdGhpc1xuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggcGFnaW5hdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYWdpbmF0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGFnaW5hdGlvbn0gYXJncy5wYWdpbmF0aW9uIC0gUGFnaW5hdGlvbiBwYXJhbXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFBhZ2luYXRpb24oe2NvbnRyb2xsZXIsIHBhZ2luYXRpb24sIHF1ZXJ5fSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbih7cGFnaW5hdGlvbiwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc2VhcmNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlYXJjaCBhcmdzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXJ9IGFyZ3MuY29udHJvbGxlciAtIENvbnRyb2xsZXIgaGFuZGxpbmcgdGhlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUFueVF1ZXJ5fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhTZWFyY2goe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgY29udHJvbGxlci5hcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgZnJvbnRlbmQtbW9kZWwgaW5kZXggc29ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlcn0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBoYW5kbGluZyB0aGUgcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQW55UXVlcnl9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTb3J0fSBhcmdzLnNvcnQgLSBTb3J0IHBhcmFtcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxJbmRleFNvcnQoe2NvbnRyb2xsZXIsIHF1ZXJ5LCBzb3J0fSkge1xuICAgIGNvbnRyb2xsZXIuYXBwbHlGcm9udGVuZE1vZGVsU29ydCh7cXVlcnksIHNvcnR9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3VwcG9ydHMgcGx1Y2suXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgcGx1Y2sgaXMgc3VwcG9ydGVkLlxuICAgKi9cbiAgc3VwcG9ydHNQbHVjayhhY3Rpb24pIHtcbiAgICB2b2lkIGFjdGlvblxuXG4gICAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5yZWNvcmRzID09PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5yZWNvcmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdXBwb3J0cyBjb3VudC5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IFByb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBjb3VudCBpcyBzdXBwb3J0ZWQuXG4gICAqL1xuICBzdXBwb3J0c0NvdW50KGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLnJlY29yZHMgPT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLnJlY29yZHMgfHxcbiAgICAgIE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKS5jb3VudCAhPT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUuY291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCB2b2lkIHwgUHJvbWlzZTxib29sZWFuIHwgdm9pZD59IC0gQ29udGludWUgcHJvY2Vzc2luZyB1bmxlc3MgZmFsc2UuXG4gICAqL1xuICBiZWZvcmVBY3Rpb24oYWN0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuc2hhcmVkUmVzb3VyY2VNZXRob2RPcihcImJlZm9yZUFjdGlvblwiLCBbYWN0aW9uXSwgKCkgPT4ge1xuICAgICAgdm9pZCBhY3Rpb25cblxuICAgICAgLy8gTm8tb3AgYnkgZGVmYXVsdC5cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gUmVjb3JkcyBmb3IgaW5kZXggYWN0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkcygpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5pbmRleFF1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbmRleCBxdWVyeSBvcHRpb25zIGZvciBjb3VudC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUluZGV4UXVlcnlPcHRpb25zfSAtIEluZGV4IHF1ZXJ5IG9wdGlvbnMgZm9yIGNvdW50LlxuICAgKi9cbiAgY291bnRJbmRleFF1ZXJ5T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlY29yZHMgY291bnQgZm9yIGluZGV4IGFjdGlvbi5cbiAgICovXG4gIGFzeW5jIGNvdW50KCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmluZGV4UXVlcnkodGhpcy5jb3VudEluZGV4UXVlcnlPcHRpb25zKCkpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEBwYXJhbSB7XCJmaW5kXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gQWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBMb2NhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgZmluZChhY3Rpb24sIGlkKSB7XG4gICAgbGV0IHF1ZXJ5ID0gdGhpcy5hdXRob3JpemVkUXVlcnkoYWN0aW9uKVxuICAgIGNvbnN0IHByZWxvYWQgPSBhY3Rpb24gPT09IFwiZmluZFwiID8gdGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLmZyb250ZW5kTW9kZWxQcmVsb2FkKCkgOiBudWxsXG5cbiAgICBpZiAocHJlbG9hZCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHByZWxvYWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmZpbmRCeShtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHRoaXMucHJpbWFyeUtleSgpLCBpZCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlUGF5bG9hZH0gYXR0cmlidXRlcyAtIENyZWF0ZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zfSBbb3B0aW9uc10gLSBTYXZlIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBDcmVhdGVkIG1vZGVsLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlKGF0dHJpYnV0ZXMsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5ub3JtYWxpemVDcmVhdGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJjcmVhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHRoaXMubW9kZWxDbGFzcygpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKHRoaXMubW9kZWxDbGFzcygpLnByb3RvdHlwZSwgTW9kZWxDbGFzcywgYXR0YWNobWVudFNwbGl0LmF0dHJpYnV0ZXMsIHRoaXMsIHBlcm1pdC5hdHRyaWJ1dGVzKVxuICAgIGNvbnN0IG1vZGVsID0gbmV3IE1vZGVsQ2xhc3MoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiY3JlYXRlXCIsXG4gICAgICBtb2RlbCxcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVmb3JlQ3JlYXRlKG1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcbiAgICAgICAgY29uc3Qgc2F2ZWRNb2RlbCA9IGF3YWl0IHRoaXMuX3NhdmVXaXRoTmVzdGVkQXR0cmlidXRlcyh7ZmlsdGVyZWQsIG1vZGVsLCBvcHRpb25zOiB7Li4ub3B0aW9ucywgYXR0YWNobWVudHM6IGF0dGFjaG1lbnRTcGxpdC5hdHRhY2htZW50c30sIHBlcm1pdH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZnRlckNyZWF0ZShzYXZlZE1vZGVsLCBub3JtYWxpemVkQXR0cmlidXRlcywgb3B0aW9ucylcblxuICAgICAgICByZXR1cm4gc2F2ZWRNb2RlbFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGUgdW5hdXRob3JpemVkIGNyZWF0ZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gQ3JlYXRlZCBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ2xlYW51cCBhZnRlciBmYWlsZWQgYXV0aG9yaXphdGlvbi5cbiAgICovXG4gIGFzeW5jIGhhbmRsZVVuYXV0aG9yaXplZENyZWF0ZWRNb2RlbChtb2RlbCkge1xuICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEV4aXN0aW5nIG1vZGVsLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IGF0dHJpYnV0ZXMgLSBVcGRhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VTYXZlT3B0aW9uc30gW29wdGlvbnNdIC0gU2F2ZSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gVXBkYXRlZCBtb2RlbC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShtb2RlbCwgYXR0cmlidXRlcywgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLm5vcm1hbGl6ZVVwZGF0ZUF0dHJpYnV0ZXMobW9kZWwsIGF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgY29uc3QgYXR0YWNobWVudFNwbGl0ID0gdGhpcy5fZXh0cmFjdEF0dGFjaG1lbnRBdHRyaWJ1dGVzKG5vcm1hbGl6ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmF0dGFjaG1lbnRzID8/IG51bGwpXG4gICAgY29uc3QgcGVybWl0ID0gcGFyc2VQZXJtaXR0ZWRQYXJhbXModGhpcy5wZXJtaXR0ZWRQYXJhbXMoe2FjdGlvbjogXCJ1cGRhdGVcIiwgYWJpbGl0eTogdGhpcy5hYmlsaXR5LCBsb2NhbHM6IHRoaXMubG9jYWxzLCBwYXJhbXM6IG5vcm1hbGl6ZWRBdHRyaWJ1dGVzfSkpXG4gICAgY29uc3QgZmlsdGVyZWQgPSBmaWx0ZXJXcml0YWJsZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsLCBtb2RlbC5nZXRNb2RlbENsYXNzKCksIGF0dGFjaG1lbnRTcGxpdC5hdHRyaWJ1dGVzLCB0aGlzLCBwZXJtaXQuYXR0cmlidXRlcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bk11dGF0aW9uVHJhbnNhY3Rpb24oe1xuICAgICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZVVwZGF0ZShtb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG4gICAgICAgIGNvbnN0IHNhdmVkTW9kZWwgPSBhd2FpdCB0aGlzLl9zYXZlV2l0aE5lc3RlZEF0dHJpYnV0ZXMoe2ZpbHRlcmVkLCBtb2RlbCwgb3B0aW9uczogey4uLm9wdGlvbnMsIGF0dGFjaG1lbnRzOiBhdHRhY2htZW50U3BsaXQuYXR0YWNobWVudHN9LCBwZXJtaXR9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJVcGRhdGUoc2F2ZWRNb2RlbCwgbm9ybWFsaXplZEF0dHJpYnV0ZXMsIG9wdGlvbnMpXG5cbiAgICAgICAgcmV0dXJuIHNhdmVkTW9kZWxcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgbW9kZWwgYW5kIGFwcGxpZXMgbmVzdGVkIGF0dHJpYnV0ZXMgaW4gb25lIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tmaWx0ZXJlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtb2RlbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIG9wdGlvbnM6IEZyb250ZW5kTW9kZWxSZXNvdXJjZVNhdmVPcHRpb25zLCBwZXJtaXQ6IHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fX0gYXJncyAtIFNhdmUgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gU2F2ZWQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfc2F2ZVdpdGhOZXN0ZWRBdHRyaWJ1dGVzKHtmaWx0ZXJlZCwgbW9kZWwsIG9wdGlvbnMsIHBlcm1pdH0pIHtcbiAgICBhd2FpdCB0aGlzLm1vZGVsQ2xhc3MoKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9hc3NpZ25XaXRoVmlydHVhbFNldHRlcnMobW9kZWwsIGZpbHRlcmVkKVxuICAgICAgdGhpcy5fYXNzaWduQXR0YWNobWVudHMobW9kZWwsIG9wdGlvbnMuYXR0YWNobWVudHMgPz8gbnVsbCwgcGVybWl0LmF0dHJpYnV0ZXMpXG5cbiAgICAgIGlmIChvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKG1vZGVsLCBvcHRpb25zLm5lc3RlZEF0dHJpYnV0ZXMsIG9wdGlvbnMuY29udHJvbGxlciB8fCBudWxsLCBwZXJtaXQpXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICBpZiAob3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhtb2RlbCwgb3B0aW9ucy5uZXN0ZWRBdHRyaWJ1dGVzLCBvcHRpb25zLmNvbnRyb2xsZXIgfHwgbnVsbCwgcGVybWl0KVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLl9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpXG5cbiAgICByZXR1cm4gbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIGF0dHJpYnV0ZXMgdG8gYSBtb2RlbCwgdXNpbmcgdmlydHVhbCBzZXR0ZXJzIG9uIHRoZSByZXNvdXJjZSB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXNzaWduV2l0aFZpcnR1YWxTZXR0ZXJzKG1vZGVsLCBhdHRyaWJ1dGVzKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgZGlyZWN0QXR0cmlidXRlcyA9IHt9XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KFJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXSlcblxuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgcmVzb3VyY2VTZXR0ZXJOYW1lID0gYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKX1BdHRyaWJ1dGVgXG4gICAgICBjb25zdCByZXNvdXJjZVNldHRlciA9IHRoaXMucmVzb3VyY2VNZXRob2QocmVzb3VyY2VTZXR0ZXJOYW1lKVxuXG4gICAgICBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgICAgYXdhaXQgcmVzb3VyY2VTZXR0ZXIubWV0aG9kLmNhbGwocmVzb3VyY2VTZXR0ZXIucmVzb3VyY2UsIG1vZGVsLCB2YWx1ZSlcbiAgICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMobmFtZSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZU9uTW9kZWwobW9kZWwsIG5hbWUsIHZhbHVlKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGlyZWN0QXR0cmlidXRlc1tuYW1lXSA9IHZhbHVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGRpcmVjdEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIG1vZGVsLmFzc2lnbihkaXJlY3RBdHRyaWJ1dGVzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTcGxpdHMgYXR0YWNobWVudC1uYW1lZCBhdHRyaWJ1dGVzIGludG8gdGhlIGF0dGFjaG1lbnQgcGF5bG9hZCB3aGlsZSBwcmVzZXJ2aW5nIGxlZ2FjeSBjYWxsZXJzXG4gICAqIHRoYXQgc3VibWl0dGVkIGF0dGFjaG1lbnRzIGFzIG5vcm1hbCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gYXR0YWNobWVudHMgLSBFeHBsaWNpdCBhdHRhY2htZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhdHRhY2htZW50czogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH19IEF0dHJpYnV0ZXMgd2l0aCBhdHRhY2htZW50IGtleXMgcmVtb3ZlZCBhbmQgbWVyZ2VkIGF0dGFjaG1lbnQgcGF5bG9hZC5cbiAgICovXG4gIF9leHRyYWN0QXR0YWNobWVudEF0dHJpYnV0ZXMoYXR0cmlidXRlcywgYXR0YWNobWVudHMpIHtcbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSB0aGlzLm1vZGVsQ2xhc3MoKS5nZXRBdHRhY2htZW50c01hcCgpXG4gICAgY29uc3QgYXR0YWNobWVudE5hbWVzID0gbmV3IFNldChPYmplY3Qua2V5cyhhdHRhY2htZW50RGVmaW5pdGlvbnMpKVxuXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lcy5zaXplID09PSAwKSByZXR1cm4ge2F0dHJpYnV0ZXMsIGF0dGFjaG1lbnRzfVxuXG4gICAgaWYgKGF0dGFjaG1lbnRzICE9PSBudWxsICYmICFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlZ3VsYXJBdHRyaWJ1dGVzID0ge31cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9ICovXG4gICAgbGV0IG1lcmdlZEF0dGFjaG1lbnRzID0gYXR0YWNobWVudHMgPyB7Li4uYXR0YWNobWVudHN9IDogbnVsbFxuXG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBpZiAoIWF0dGFjaG1lbnROYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgcmVndWxhckF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1lcmdlZEF0dGFjaG1lbnRzKSBtZXJnZWRBdHRhY2htZW50cyA9IHt9XG4gICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1lcmdlZEF0dGFjaG1lbnRzLCBhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJyR7YXR0cmlidXRlTmFtZX0nIHdhcyBzdWJtaXR0ZWQgaW4gYm90aCBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cy5gKVxuICAgICAgfVxuXG4gICAgICBtZXJnZWRBdHRhY2htZW50c1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHthdHRyaWJ1dGVzOiByZWd1bGFyQXR0cmlidXRlcywgYXR0YWNobWVudHM6IG1lcmdlZEF0dGFjaG1lbnRzfVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhdHRhY2htZW50IHBheWxvYWRzIG9uIGEgbW9kZWwgYWZ0ZXIgdmFsaWRhdGluZyBwZXJtaXRzIGFuZCBhdHRhY2htZW50IGRlZmluaXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHJlY2VpdmluZyBhdHRhY2htZW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRhY2htZW50cyAtIEF0dGFjaG1lbnRzIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGVybWl0dGVkQXR0cmlidXRlTmFtZXMgLSBBdHRyaWJ1dGUvYXR0YWNobWVudCBuYW1lcyBwZXJtaXR0ZWQgYnkgdGhlIHJlc291cmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9hc3NpZ25BdHRhY2htZW50cyhtb2RlbCwgYXR0YWNobWVudHMsIHBlcm1pdHRlZEF0dHJpYnV0ZU5hbWVzKSB7XG4gICAgaWYgKCFhdHRhY2htZW50cykgcmV0dXJuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dGFjaG1lbnRzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuXG4gICAgY29uc3QgcGVybWl0U2V0ID0gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcylcbiAgICBjb25zdCBtb2RlbENsYXNzID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0YWNobWVudERlZmluaXRpb25zID0gbW9kZWxDbGFzcy5nZXRBdHRhY2htZW50c01hcCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBub3RQZXJtaXR0ZWRBdHRhY2htZW50cyA9IFtdXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBpbnZhbGlkQXR0YWNobWVudHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBbYXR0YWNobWVudE5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRhY2htZW50cykpIHtcbiAgICAgIGlmICghcGVybWl0U2V0LmhhcyhhdHRhY2htZW50TmFtZSkpIHtcbiAgICAgICAgbm90UGVybWl0dGVkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGlmICghYXR0YWNobWVudERlZmluaXRpb25zW2F0dGFjaG1lbnROYW1lXSkge1xuICAgICAgICBpbnZhbGlkQXR0YWNobWVudHMucHVzaChhdHRhY2htZW50TmFtZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgbW9kZWwuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkucXVldWVBdHRhY2godmFsdWUpXG4gICAgfVxuXG4gICAgaWYgKG5vdFBlcm1pdHRlZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEZyb250ZW5kIG1vZGVsIGF0dGFjaG1lbnQgbmFtZXMgbm90IHBlcm1pdHRlZCBieSBwZXJtaXR0ZWRQYXJhbXMoKTogJHtub3RQZXJtaXR0ZWRBdHRhY2htZW50cy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICAgIH1cbiAgICBpZiAoaW52YWxpZEF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYEludmFsaWQgZnJvbnRlbmQgbW9kZWwgYXR0YWNobWVudCBuYW1lczogJHtpbnZhbGlkQXR0YWNobWVudHMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHRyYW5zbGF0ZWQgYXR0cmlidXRlIG9uIGEgbW9kZWwgdmlhIHRoZSB0cmFuc2xhdGlvbnMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gdmFsdWUgLSBBdHRyaWJ1dGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGVPbk1vZGVsKG1vZGVsLCBuYW1lLCB2YWx1ZSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbnRleHQ/LmNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uID8gY29uZmlndXJhdGlvbi5nZXRMb2NhbGUoKSA6IFwiZW5cIlxuICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwidHJhbnNsYXRpb25zXCIpXG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHtcbiAgICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgdHJhbnNsYXRpb24gPSBsb2FkZWQuZmluZCgodCkgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0KS5sb2NhbGUoKSA9PT0gbG9jYWxlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSB7XG4gICAgICAgIGF3YWl0IG1vZGVsLmxvYWRSZWxhdGlvbnNoaXAoXCJ0cmFuc2xhdGlvbnNcIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkKSkge1xuICAgICAgICB0cmFuc2xhdGlvbiA9IGxvYWRlZC5maW5kKCh0KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHQpLmxvY2FsZSgpID09PSBsb2NhbGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgdHJhbnNsYXRpb24gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5idWlsZCh7bG9jYWxlfSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IHt9XG5cbiAgICBhc3NpZ25tZW50c1tuYW1lXSA9IHZhbHVlXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBFeGlzdGluZyBtb2RlbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveShtb2RlbCkge1xuICAgIGF3YWl0IHRoaXMucnVuTXV0YXRpb25UcmFuc2FjdGlvbih7XG4gICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgbW9kZWwsXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZm9yZURlc3Ryb3kobW9kZWwpXG4gICAgICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICAgICAgICBhd2FpdCB0aGlzLmFmdGVyRGVzdHJveShtb2RlbClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIHRvIHNlcmlhbGl6ZS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwifSBbYWN0aW9uXSAtIEFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemUobW9kZWwsIGFjdGlvbikge1xuICAgIHZvaWQgYWN0aW9uXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy50eXBlZENvbnRyb2xsZXJJbnN0YW5jZSgpLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY29tbW9uIG1ldGFkYXRhIGZvciBvbmUgbmVzdGVkLWF0dHJpYnV0ZXMgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE5lc3RlZCByZWxhdGlvbnNoaXAgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCByZWNlaXZpbmcgbmVzdGVkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlUGF5bG9hZFZhbHVlfSBhcmdzLnJhd0VudHJpZXMgLSBSYXcgbmVzdGVkIGVudHJpZXMgZnJvbSB0aGUgcmVxdWVzdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBhcmdzLmNoaWxkUGVybWl0IC0gUGFyc2VkIGNoaWxkIHBlcm1pdC5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VDb250cm9sbGVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5jb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgY2hpbGQgcmVzb3VyY2UgbG9va3VwLlxuICAgKiBAcmV0dXJucyB7e2FiaWxpdHk6IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBjaGlsZFJlc291cmNlOiBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLCBjaGlsZFJlc291cmNlQ29uZmlnOiBGcm9udGVuZE1vZGVsUmVzb2x2ZWRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBzdHJpbmdbXSwgZGVzdHJveVBlcm1pdHRlZDogYm9vbGVhbiwgZW50cmllczogQXJyYXk8RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnk+LCByZWxhdGlvbnNoaXA6IGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCwgdGFyZ2V0TW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gTmVzdGVkIHJlbGF0aW9uc2hpcCBjb250ZXh0LlxuICAgKi9cbiAgX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe3BhcmVudCwgcmVsYXRpb25zaGlwTmFtZSwgcmF3RW50cmllcywgY2hpbGRQZXJtaXQsIGNvbnRyb2xsZXJ9KSB7XG4gICAgaWYgKCFjb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScgcmVxdWlyZSBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuYClcbiAgICB9XG5cbiAgICBjb25zdCBwYXJlbnRNb2RlbENsYXNzID0gcGFyZW50LmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IG1vZGVsQWNjZXB0YW5jZSA9IHBhcmVudE1vZGVsQ2xhc3MuYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBpZiAoIW1vZGVsQWNjZXB0YW5jZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWNjZXB0IG5lc3RlZCBhdHRyaWJ1dGVzIGZvciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIERlY2xhcmUgaXQgdmlhICR7cGFyZW50TW9kZWxDbGFzcy5uYW1lfS5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcignJHtyZWxhdGlvbnNoaXBOYW1lfScpLmApXG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcGFyZW50TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gcmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgIGNvbnN0IHJhd05vcm1hbGl6ZWRFbnRyaWVzID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwRW50cmllcyh7cmF3RW50cmllcywgcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwVHlwZX0pXG4gICAgY29uc3QgZGVzdHJveVBlcm1pdHRlZCA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuaW5jbHVkZXMoXCJfZGVzdHJveVwiKVxuXG4gICAgaWYgKGRlc3Ryb3lQZXJtaXR0ZWQgJiYgIW1vZGVsQWNjZXB0YW5jZS5hbGxvd0Rlc3Ryb3kpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgcGVybWl0cyBfZGVzdHJveSBvbiBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gYnV0IHRoZSBtb2RlbCAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0gZG9lcyBub3QgYWxsb3cgZGVzdHJveSBmb3IgdGhhdCByZWxhdGlvbnNoaXAuIFNldCB7YWxsb3dEZXN0cm95OiB0cnVlfSBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoJyR7cmVsYXRpb25zaGlwTmFtZX0nLCAuLi4pLmApXG4gICAgfVxuICAgIGlmICh0eXBlb2YgbW9kZWxBY2NlcHRhbmNlLmxpbWl0ID09PSBcIm51bWJlclwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IG1vZGVsQWNjZXB0YW5jZS5saW1pdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZXhjZWVkcyBtb2RlbC1kZWNsYXJlZCBsaW1pdCBvZiAke21vZGVsQWNjZXB0YW5jZS5saW1pdH0uYClcbiAgICB9XG4gICAgaWYgKHJlbGF0aW9uc2hpcFR5cGUgIT09IFwiaGFzTWFueVwiICYmIHJhd05vcm1hbGl6ZWRFbnRyaWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGFjY2VwdHMgb25lIGVudHJ5IGZvciAke3JlbGF0aW9uc2hpcFR5cGV9IHJlbGF0aW9uc2hpcHMuYClcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyByZXNvbHZlZCBmb3IgcmVsYXRpb25zaGlwICcke3JlbGF0aW9uc2hpcE5hbWV9JyBvbiAke3BhcmVudE1vZGVsQ2xhc3MubmFtZX0uYClcbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZFJlc291cmNlQ29uZmlnID0gY29udHJvbGxlci5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgaWYgKCFjaGlsZFJlc291cmNlQ29uZmlnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHJlZ2lzdGVyZWQgZm9yIGNoaWxkIG1vZGVsICcke3RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9JyB1bmRlciByZWxhdGlvbnNoaXAgJyR7cmVsYXRpb25zaGlwTmFtZX0nLmApXG4gICAgfVxuXG4gICAgY29uc3QgY2hpbGRSZXNvdXJjZSA9IG5ldyBjaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eTogdGhpcy5hYmlsaXR5LFxuICAgICAgY29udHJvbGxlcixcbiAgICAgIGNvbnRleHQ6IHRoaXMuY29udGV4dCB8fCB7fSxcbiAgICAgIGxvY2FsczogdGhpcy5sb2NhbHMgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgbW9kZWxOYW1lOiBjaGlsZFJlc291cmNlQ29uZmlnLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogY29udHJvbGxlci5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfSlcbiAgICBjb25zdCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcyA9IGNoaWxkUGVybWl0LmF0dHJpYnV0ZXMuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIl9kZXN0cm95XCIpXG4gICAgY29uc3QgZW50cmllcyA9IHJhd05vcm1hbGl6ZWRFbnRyaWVzXG4gICAgICAubWFwKChlbnRyeSkgPT4gdGhpcy5fbm9ybWFsaXplTmVzdGVkUmVsYXRpb25zaGlwRW50cnkoe2NoaWxkUGVybWl0LCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGVudHJ5LCByZWxhdGlvbnNoaXBOYW1lLCB0YXJnZXRNb2RlbENsYXNzfSkpXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIG1vZGVsQWNjZXB0YW5jZS5yZWplY3RJZiAhPT0gXCJmdW5jdGlvblwiKSByZXR1cm4gdHJ1ZVxuXG4gICAgICAgIHJldHVybiAhbW9kZWxBY2NlcHRhbmNlLnJlamVjdElmKGlzUGxhaW5PYmplY3QoZW50cnkuYXR0cmlidXRlcykgPyBlbnRyeS5hdHRyaWJ1dGVzIDoge30pXG4gICAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFiaWxpdHk6IGNvbnRyb2xsZXIuY3VycmVudEFiaWxpdHkoKSB8fCB0aGlzLmFiaWxpdHksXG4gICAgICBjaGlsZFJlc291cmNlLFxuICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZyxcbiAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgZGVzdHJveVBlcm1pdHRlZCxcbiAgICAgIGVudHJpZXMsXG4gICAgICByZWxhdGlvbnNoaXAsXG4gICAgICB0YXJnZXRNb2RlbENsYXNzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgbmVzdGVkIGVudHJpZXMgZm9yIGNvbGxlY3Rpb24gYW5kIHNpbmd1bGFyIHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTmVzdGVkIGVudHJpZXMgaW5wdXRzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZVBheWxvYWRWYWx1ZX0gYXJncy5yYXdFbnRyaWVzIC0gUmF3IG5lc3RlZCBlbnRyaWVzIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcFR5cGUgLSBSZWxhdGlvbnNoaXAgdHlwZS5cbiAgICogQHJldHVybnMge0FycmF5PEZyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5Pn0gTm9ybWFsaXplZCBuZXN0ZWQgZW50cnkgb2JqZWN0cy5cbiAgICovXG4gIF9uZXN0ZWRSZWxhdGlvbnNoaXBFbnRyaWVzKHtyYXdFbnRyaWVzLCByZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBUeXBlfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09PSBcImhhc01hbnlcIikge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJhd0VudHJpZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXJyYXkgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHJhd0VudHJpZXMgPT0gbnVsbCkgcmV0dXJuIFtdXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmF3RW50cmllcykpIHtcbiAgICAgIHJldHVybiByYXdFbnRyaWVzLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cmllcyBtdXN0IGJlIG9iamVjdHMuYClcblxuICAgICAgICAvLyBOYXJyb3dzIHRoZSBwbGFpbi1vYmplY3QgcGF5bG9hZCB0byBhIG5vcm1hbGl6ZWQgbmVzdGVkLWVudHJ5IG9iamVjdC5cbiAgICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFJlc291cmNlTmVzdGVkRW50cnl9ICovIChlbnRyeSlcbiAgICAgIH0pXG4gICAgfVxuICAgIGlmICghaXNQbGFpbk9iamVjdChyYXdFbnRyaWVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvYmplY3QgZm9yIG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBidXQgZ290OiAke3R5cGVvZiByYXdFbnRyaWVzfWApXG4gICAgfVxuXG4gICAgLy8gTmFycm93cyB0aGUgcGxhaW4tb2JqZWN0IHBheWxvYWQgdG8gYSBub3JtYWxpemVkIG5lc3RlZC1lbnRyeSBvYmplY3QuXG4gICAgcmV0dXJuIFsvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSAqLyAocmF3RW50cmllcyldXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgbmVzdGVkIGVudHJ5IGZyb20gZWl0aGVyIGludGVybmFsIHRyYW5zcG9ydCBzaGFwZVxuICAgKiAoYHthdHRyaWJ1dGVzLCBhdHRhY2htZW50cywgbmVzdGVkQXR0cmlidXRlc31gKSBvciBkaXJlY3QgUmFpbHMtc3R5bGVcbiAgICogZmllbGRzIChge25hbWUsIGZpbGUsIGNvbW1lbnRzQXR0cmlidXRlc31gKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBOb3JtYWxpemF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncy5jaGlsZFBlcm1pdCAtIFBhcnNlZCBjaGlsZCBwZXJtaXQgc3BlYy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSBhcmdzLmNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gYXJncy5lbnRyeSAtIFJhdyBuZXN0ZWQgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxSZXNvdXJjZU5lc3RlZEVudHJ5fSBOb3JtYWxpemVkIG5lc3RlZCBlbnRyeS5cbiAgICovXG4gIF9ub3JtYWxpemVOZXN0ZWRSZWxhdGlvbnNoaXBFbnRyeSh7Y2hpbGRQZXJtaXQsIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBlbnRyeSwgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSAqL1xuICAgIGNvbnN0IGF0dGFjaG1lbnRzID0ge31cbiAgICAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9ICovXG4gICAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VOZXN0ZWRFbnRyeX0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cbiAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbnMgPSB0YXJnZXRNb2RlbENsYXNzLmdldEF0dGFjaG1lbnRzTWFwKClcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhlbnRyeSkpIHtcbiAgICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSBcImlkXCIpIHtcbiAgICAgICAgY29uc3QgcHJpbWFyeUtleSA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkgfHwgdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcblxuICAgICAgICBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIHZhbHVlKVxuICAgICAgICBub3JtYWxpemVkLmlkID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gKi8gKHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJfZGVzdHJveVwiKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgX2Rlc3Ryb3kgbXVzdCBiZSBhIGJvb2xlYW4uYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5vcm1hbGl6ZWQuX2Rlc3Ryb3kgPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJhdHRyaWJ1dGVzXCIpIHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgYXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKGF0dHJpYnV0ZXMsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJhdHRhY2htZW50c1wiKSB7XG4gICAgICAgIGlmICghaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IGF0dGFjaG1lbnRzIG11c3QgYmUgYW4gb2JqZWN0LmApXG4gICAgICAgIE9iamVjdC5hc3NpZ24oYXR0YWNobWVudHMsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZSA9PT0gXCJuZXN0ZWRBdHRyaWJ1dGVzXCIpIHtcbiAgICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHZhbHVlKSkgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgbmVzdGVkQXR0cmlidXRlcyBtdXN0IGJlIGFuIG9iamVjdC5gKVxuICAgICAgICBPYmplY3QuYXNzaWduKG5lc3RlZEF0dHJpYnV0ZXMsIHZhbHVlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgICAgY29uc3QgbmVzdGVkUmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcblxuICAgICAgICBpZiAoIW5lc3RlZFJlbGF0aW9uc2hpcE5hbWUpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBuZXN0ZWQgYXR0cmlidXRlcyBrZXk6ICR7YXR0cmlidXRlTmFtZX1gKVxuICAgICAgICBpZiAoIWNoaWxkUGVybWl0Lm5lc3RlZFtuZXN0ZWRSZWxhdGlvbnNoaXBOYW1lXSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke25lc3RlZFJlbGF0aW9uc2hpcE5hbWV9JyBhcmUgbm90IHBlcm1pdHRlZCB1bmRlciAnJHtyZWxhdGlvbnNoaXBOYW1lfScuIEluY2x1ZGUgeyR7YXR0cmlidXRlTmFtZX06IFsuLi5dfSBpbiB0aGF0IG5lc3RlZCBwZXJtaXQuYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXNbbmVzdGVkUmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoYXR0YWNobWVudERlZmluaXRpb25zW2F0dHJpYnV0ZU5hbWVdKSB7XG4gICAgICAgIGF0dGFjaG1lbnRzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKS5sZW5ndGggPiAwKSBub3JtYWxpemVkLmF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzXG4gICAgaWYgKE9iamVjdC5rZXlzKGF0dGFjaG1lbnRzKS5sZW5ndGggPiAwKSBub3JtYWxpemVkLmF0dGFjaG1lbnRzID0gYXR0YWNobWVudHNcbiAgICBpZiAoT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCkgbm9ybWFsaXplZC5uZXN0ZWRBdHRyaWJ1dGVzID0gbmVzdGVkQXR0cmlidXRlc1xuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGJlbG9uZ3MtdG8gbmVzdGVkIGF0dHJpYnV0ZXMgYmVmb3JlIHRoZSBwYXJlbnQgc2F2ZSBzbyB0aGUgcGFyZW50IEZLIGNhbiBiZSBzZXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVQYXlsb2FkfSBuZXN0ZWRBdHRyaWJ1dGVzIC0gTmVzdGVkLWF0dHJpYnV0ZSBwYXlsb2FkIGtleWVkIGJ5IHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUNvbnRyb2xsZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBjb250cm9sbGVyIC0gQ29udHJvbGxlciBpbnN0YW5jZSBmb3IgcmVzb3VyY2UgcmVzb2x1dGlvbiBhbmQgYXV0aG9yaXphdGlvbi5cbiAgICogQHBhcmFtIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IG51bGx9IFtwYXJlbnRQZXJtaXRdIC0gUGFyc2VkIHBhcmVudCBwZXJtaXQgc3BlYy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKHBhcmVudCwgbmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgcGFyZW50UGVybWl0ID0gbnVsbCkge1xuICAgIGNvbnN0IHJlc29sdmVkUGFyZW50ID0gcGFyZW50UGVybWl0XG4gICAgICB8fCBwYXJzZVBlcm1pdHRlZFBhcmFtcyh0aGlzLnBlcm1pdHRlZFBhcmFtcyh7YWN0aW9uOiBcInVwZGF0ZVwiLCBhYmlsaXR5OiB0aGlzLmFiaWxpdHksIGxvY2FsczogdGhpcy5sb2NhbHMsIHBhcmFtczoge319KSlcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgY2hpbGRQZXJtaXQgPSByZXNvbHZlZFBhcmVudC5uZXN0ZWRbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFjaGlsZFBlcm1pdCkgY29udGludWVcblxuICAgICAgY29uc3QgY29udGV4dCA9IHRoaXMuX25lc3RlZFJlbGF0aW9uc2hpcENvbnRleHQoe1xuICAgICAgICBjaGlsZFBlcm1pdCxcbiAgICAgICAgY29udHJvbGxlcixcbiAgICAgICAgcGFyZW50LFxuICAgICAgICByYXdFbnRyaWVzOiBuZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lXG4gICAgICB9KVxuXG4gICAgICBpZiAoY29udGV4dC5yZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKGNvbnRleHQucmVsYXRpb25zaGlwLCBwYXJlbnQuZ2V0TW9kZWxDbGFzcygpKVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRleHQuZW50cmllcykge1xuICAgICAgICBpZiAoZW50cnkuX2Rlc3Ryb3kpIHtcbiAgICAgICAgICBpZiAoIWNvbnRleHQuZGVzdHJveVBlcm1pdHRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gZW50cnkgcmVxdWVzdGVkIF9kZXN0cm95IGJ1dCBcIl9kZXN0cm95XCIgaXMgbm90IGluIHRoZSBwZXJtaXQgZm9yIHRoaXMgcmVsYXRpb25zaGlwLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcblxuICAgICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIF9kZXN0cm95IGVudHJ5IGlzIG1pc3NpbmcgYW4gaWQuYClcblxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5fZmluZE5lc3RlZFJlY29yZCh7XG4gICAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBpZCxcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLmRlc3Ryb3koZXhpc3RpbmcpXG4gICAgICAgICAgcGFyZW50LnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBudWxsKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpZCA9IGVudHJ5LmlkXG4gICAgICAgIGNvbnN0IGNoaWxkID0gaWQgIT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyBhd2FpdCB0aGlzLl9maW5kTmVzdGVkUmVjb3JkKHtcbiAgICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgICAgaWQsXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgICAgfSlcbiAgICAgICAgICA6IG5ldyBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXNzaWduTmVzdGVkRW50cnlUb0NoaWxkKHtcbiAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogY29udGV4dC5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgICAgICBlbnRyeVxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcyB8fCB7fSwgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIGF3YWl0IGNoaWxkLnNhdmUoKVxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9hdXRob3JpemVDcmVhdGVkQ2hpbGQoe1xuICAgICAgICAgICAgYWJpbGl0eTogY29udGV4dC5hYmlsaXR5LFxuICAgICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgICBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbjogY29udGV4dC5jaGlsZFJlc291cmNlQ29uZmlnLnJlc291cmNlQ29uZmlndXJhdGlvbixcbiAgICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5TmVzdGVkQXR0cmlidXRlcyhjaGlsZCwgZW50cnkubmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIH1cblxuICAgICAgICBwYXJlbnQuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKGNoaWxkLmlkKCksIGBOZXN0ZWQgYmVsb25ncy10byB3cml0ZSBmb3IgJHtjaGlsZC5nZXRNb2RlbENsYXNzKCkubmFtZX1gKSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIGBuZXN0ZWRBdHRyaWJ1dGVzYCBwYXlsb2FkIHRvIGEgZnJlc2hseS1zYXZlZCBwYXJlbnQgbW9kZWwsXG4gICAqIGNhc2NhZGluZyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgd3JpdGVzIGFjcm9zcyB0aGUgZGVjbGFyZWQgcmVsYXRpb25zaGlwcy5cbiAgICpcbiAgICogRWFjaCBjaGlsZCBpcyBhdXRob3JpemVkIGFnYWluc3QgaXRzIG93biByZXNvdXJjZSdzIGFiaWxpdGllcyAobmV2ZXIgdGhlXG4gICAqIHBhcmVudCdzKS4gRGVzdHJveXMgcnVuIGJlZm9yZSB1cGRhdGVzLCB1cGRhdGVzIGJlZm9yZSBjcmVhdGVzLCB0byBhdm9pZFxuICAgKiB1bmlxdWUtY29uc3RyYWludCBjb25mbGljdHMgd2hlbiByZXBsYWNpbmcgYSBjaGlsZCBhdCB0aGUgc2FtZSBuYXR1cmFsIGtleS5cbiAgICpcbiAgICogQXR0cmlidXRlIGZpbHRlcmluZyBmb3IgbmVzdGVkIGNoaWxkcmVuIHVzZXMgdGhlIHBhcmVudCByZXNvdXJjZSdzXG4gICAqIHBlcm1pdCBzcGVjIGZvciB0aGF0IHJlbGF0aW9uc2hpcCDigJQgYXBpX21ha2VyLXN0eWxlLiBQb2xpY3kgb3B0aW9uc1xuICAgKiAoYWxsb3dEZXN0cm95LCBsaW1pdCwgcmVqZWN0SWYpIGNvbWUgZnJvbSB0aGUgTU9ERUwnc1xuICAgKiBgYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKG5hbWUpYCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcGFyZW50IC0gUGFyZW50IG1vZGVsIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZVBheWxvYWR9IG5lc3RlZEF0dHJpYnV0ZXMgLSBOZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQga2V5ZWQgYnkgcmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFJlc291cmNlQ29udHJvbGxlciB8IG51bGwgfCB1bmRlZmluZWR9IGNvbnRyb2xsZXIgLSBDb250cm9sbGVyIGluc3RhbmNlIGZvciByZXNvdXJjZSByZXNvbHV0aW9uIGFuZCBhdXRob3JpemF0aW9uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwgbnVsbH0gW3BhcmVudFBlcm1pdF0gLSBQYXJzZWQgcGFyZW50IHBlcm1pdCBzcGVjLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hcHBseU5lc3RlZEF0dHJpYnV0ZXMocGFyZW50LCBuZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBwYXJlbnRQZXJtaXQgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb2x2ZWRQYXJlbnQgPSBwYXJlbnRQZXJtaXRcbiAgICAgIHx8IHBhcnNlUGVybWl0dGVkUGFyYW1zKHRoaXMucGVybWl0dGVkUGFyYW1zKHthY3Rpb246IFwidXBkYXRlXCIsIGFiaWxpdHk6IHRoaXMuYWJpbGl0eSwgbG9jYWxzOiB0aGlzLmxvY2FscywgcGFyYW1zOiB7fX0pKVxuXG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBjaGlsZFBlcm1pdCA9IHJlc29sdmVkUGFyZW50Lm5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIWNoaWxkUGVybWl0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTmVzdGVkIGF0dHJpYnV0ZXMgZm9yICcke3JlbGF0aW9uc2hpcE5hbWV9JyBhcmUgbm90IHBlcm1pdHRlZCBieSAke3RoaXMuY29uc3RydWN0b3IubmFtZX0ucGVybWl0dGVkUGFyYW1zKCkuIEluY2x1ZGUgeyR7cmVsYXRpb25zaGlwTmFtZX1BdHRyaWJ1dGVzOiBbLi4uXX0gaW4gdGhlIHJldHVybmVkIHBlcm1pdC5gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5fbmVzdGVkUmVsYXRpb25zaGlwQ29udGV4dCh7XG4gICAgICAgIGNoaWxkUGVybWl0LFxuICAgICAgICBjb250cm9sbGVyLFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIHJhd0VudHJpZXM6IG5lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV0sXG4gICAgICAgIHJlbGF0aW9uc2hpcE5hbWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb250ZXh0LnJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHBhcmVudExpbmtBdHRyaWJ1dGVzID0gdGhpcy5fcGFyZW50TGlua0F0dHJpYnV0ZXNGb3JOZXN0ZWRDaGlsZCh7XG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgcmVsYXRpb25zaGlwOiBjb250ZXh0LnJlbGF0aW9uc2hpcCxcbiAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBjb25zdCBkZXN0cm95RW50cmllcyA9IFtdXG4gICAgICBjb25zdCB1cGRhdGVFbnRyaWVzID0gW11cbiAgICAgIGNvbnN0IGNyZWF0ZUVudHJpZXMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnRleHQuZW50cmllcykge1xuICAgICAgICBpZiAoZW50cnk/Ll9kZXN0cm95KSB7XG4gICAgICAgICAgaWYgKCFjb250ZXh0LmRlc3Ryb3lQZXJtaXR0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgbmVzdGVkQXR0cmlidXRlc1snJHtyZWxhdGlvbnNoaXBOYW1lfSddIGVudHJ5IHJlcXVlc3RlZCBfZGVzdHJveSBidXQgXCJfZGVzdHJveVwiIGlzIG5vdCBpbiB0aGUgcGVybWl0IGZvciB0aGlzIHJlbGF0aW9uc2hpcC5gKVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWVudHJ5LmlkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSBfZGVzdHJveSBlbnRyeSBpcyBtaXNzaW5nIGFuIGlkLmApXG4gICAgICAgICAgfVxuICAgICAgICAgIGRlc3Ryb3lFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH0gZWxzZSBpZiAoZW50cnk/LmlkKSB7XG4gICAgICAgICAgdXBkYXRlRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNyZWF0ZUVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGRlc3Ryb3lFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGlkID0gZW50cnkuaWRcblxuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBuZXN0ZWRBdHRyaWJ1dGVzWycke3JlbGF0aW9uc2hpcE5hbWV9J10gX2Rlc3Ryb3kgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgICAgICAgIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uOiBjb250ZXh0LmNoaWxkUmVzb3VyY2VDb25maWcucmVzb3VyY2VDb25maWd1cmF0aW9uLFxuICAgICAgICAgIGlkLFxuICAgICAgICAgIHBhcmVudCxcbiAgICAgICAgICBwYXJlbnRMaW5rQXR0cmlidXRlcyxcbiAgICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICAgIHRhcmdldE1vZGVsQ2xhc3M6IGNvbnRleHQudGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5kZXN0cm95KGV4aXN0aW5nKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHVwZGF0ZUVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBlbnRyeS5pZFxuXG4gICAgICAgIGlmIChpZCA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYG5lc3RlZEF0dHJpYnV0ZXNbJyR7cmVsYXRpb25zaGlwTmFtZX0nXSB1cGRhdGUgZW50cnkgaXMgbWlzc2luZyBhbiBpZC5gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLl9maW5kU2NvcGVkQ2hpbGQoe1xuICAgICAgICAgIGFiaWxpdHk6IGNvbnRleHQuYWJpbGl0eSxcbiAgICAgICAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgcGFyZW50LFxuICAgICAgICAgIHBhcmVudExpbmtBdHRyaWJ1dGVzLFxuICAgICAgICAgIHJlbGF0aW9uc2hpcE5hbWUsXG4gICAgICAgICAgdGFyZ2V0TW9kZWxDbGFzczogY29udGV4dC50YXJnZXRNb2RlbENsYXNzXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkOiBleGlzdGluZyxcbiAgICAgICAgICBjaGlsZFdyaXRhYmxlQXR0cmlidXRlczogY29udGV4dC5jaGlsZFdyaXRhYmxlQXR0cmlidXRlcyxcbiAgICAgICAgICBlbnRyeVxuICAgICAgICB9KVxuICAgICAgICBhd2FpdCBjb250ZXh0LmNoaWxkUmVzb3VyY2UuX2FwcGx5QmVsb25nc1RvTmVzdGVkQXR0cmlidXRlcyhleGlzdGluZywgZW50cnkubmVzdGVkQXR0cmlidXRlcyB8fCB7fSwgY29udHJvbGxlciwgY2hpbGRQZXJtaXQpXG4gICAgICAgIGF3YWl0IGV4aXN0aW5nLnNhdmUoKVxuXG4gICAgICAgIGlmIChlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hcHBseU5lc3RlZEF0dHJpYnV0ZXMoZXhpc3RpbmcsIGVudHJ5Lm5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXIsIGNoaWxkUGVybWl0KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3JlYXRlRW50cmllcykge1xuICAgICAgICBjb25zdCBjaGlsZCA9IG5ldyBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGNoaWxkLmFzc2lnbihwYXJlbnRMaW5rQXR0cmlidXRlcylcbiAgICAgICAgYXdhaXQgY29udGV4dC5jaGlsZFJlc291cmNlLl9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe1xuICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgIGNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzOiBjb250ZXh0LmNoaWxkV3JpdGFibGVBdHRyaWJ1dGVzLFxuICAgICAgICAgIGVudHJ5XG4gICAgICAgIH0pXG4gICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlCZWxvbmdzVG9OZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzIHx8IHt9LCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgYXdhaXQgY2hpbGQuc2F2ZSgpXG5cbiAgICAgICAgYXdhaXQgdGhpcy5fYXV0aG9yaXplQ3JlYXRlZENoaWxkKHtcbiAgICAgICAgICBhYmlsaXR5OiBjb250ZXh0LmFiaWxpdHksXG4gICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb246IGNvbnRleHQuY2hpbGRSZXNvdXJjZUNvbmZpZy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgICB0YXJnZXRNb2RlbENsYXNzOiBjb250ZXh0LnRhcmdldE1vZGVsQ2xhc3NcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoZW50cnkubmVzdGVkQXR0cmlidXRlcykge1xuICAgICAgICAgIGF3YWl0IGNvbnRleHQuY2hpbGRSZXNvdXJjZS5fYXBwbHlOZXN0ZWRBdHRyaWJ1dGVzKGNoaWxkLCBlbnRyeS5uZXN0ZWRBdHRyaWJ1dGVzLCBjb250cm9sbGVyLCBjaGlsZFBlcm1pdClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIG9uZSBuZXN0ZWQgZW50cnkncyBhdHRyaWJ1dGVzIGFuZCBhdHRhY2htZW50cyB0byBhIGNoaWxkIG1vZGVsLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFzc2lnbm1lbnQgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNoaWxkIC0gQ2hpbGQgbW9kZWwgcmVjZWl2aW5nIGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuY2hpbGRXcml0YWJsZUF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgY2hpbGQgYXR0cmlidXRlIGFuZCBhdHRhY2htZW50IG5hbWVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5lbnRyeSAtIE5lc3RlZCBlbnRyeSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9hc3NpZ25OZXN0ZWRFbnRyeVRvQ2hpbGQoe2NoaWxkLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcywgZW50cnl9KSB7XG4gICAgaWYgKGVudHJ5LmF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5LmF0dHJpYnV0ZXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBuZXN0ZWQgZW50cnkgYXR0cmlidXRlcyB0byBiZSBhbiBvYmplY3QuXCIpXG5cbiAgICAgIGNvbnN0IGZpbHRlcmVkID0gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhjaGlsZCwgY2hpbGQuZ2V0TW9kZWxDbGFzcygpLCBlbnRyeS5hdHRyaWJ1dGVzLCB0aGlzLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcylcbiAgICAgIGF3YWl0IHRoaXMuX2Fzc2lnbldpdGhWaXJ0dWFsU2V0dGVycyhjaGlsZCwgZmlsdGVyZWQpXG4gICAgfVxuXG4gICAgaWYgKGVudHJ5LmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQgJiYgIWlzUGxhaW5PYmplY3QoZW50cnkuYXR0YWNobWVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBuZXN0ZWQgZW50cnkgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiKVxuICAgIH1cblxuICAgIHRoaXMuX2Fzc2lnbkF0dGFjaG1lbnRzKGNoaWxkLCBlbnRyeS5hdHRhY2htZW50cyA/PyBudWxsLCBjaGlsZFdyaXRhYmxlQXR0cmlidXRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHJlbGF0aW9uc2hpcCdzIGZvcmVpZ24ta2V5IGNvbHVtbi9uYW1lIHRvIHRoZSB0YXJnZXQgbW9kZWwncyBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBjb250YWluaW5nIHRoZSBGSy5cbiAgICogQHJldHVybnMge3N0cmluZ30gRm9yZWlnbi1rZXkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBfZm9yZWlnbktleUF0dHJpYnV0ZUZvck1vZGVsKHJlbGF0aW9uc2hpcCwgbW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV0gfHwgZm9yZWlnbktleVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIEZLIGF0dHJpYnV0ZXMgdGhhdCBiaW5kIGEgbmVzdGVkIGNoaWxkIHRvIGl0cyBwYXJlbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFyZW50LWxpbmsgaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy50YXJnZXRNb2RlbENsYXNzIC0gQ2hpbGQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBBdHRyaWJ1dGVzIHRoYXQgc2NvcGUgdGhlIGNoaWxkIHRvIHRoZSBwYXJlbnQuXG4gICAqL1xuICBfcGFyZW50TGlua0F0dHJpYnV0ZXNGb3JOZXN0ZWRDaGlsZCh7cGFyZW50LCByZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX2ZvcmVpZ25LZXlBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7W2ZvcmVpZ25LZXldOiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShwYXJlbnQuaWQoKSwgYE5lc3RlZCBjaGlsZCB3cml0ZSBmb3IgJHtwYXJlbnQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YCl9XG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkpIHtcbiAgICAgIGNvbnN0IHR5cGVBdHRyaWJ1dGUgPSB0aGlzLl9wb2x5bW9ycGhpY1R5cGVBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgIGF0dHJpYnV0ZXNbdHlwZUF0dHJpYnV0ZV0gPSBwYXJlbnQuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHJlbGF0aW9uc2hpcCdzIHBvbHltb3JwaGljIHR5cGUgY29sdW1uL25hbWUgdG8gYSBjaGlsZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBjb250YWluaW5nIHRoZSB0eXBlIGNvbHVtbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gUG9seW1vcnBoaWMgdHlwZSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIF9wb2x5bW9ycGhpY1R5cGVBdHRyaWJ1dGVGb3JNb2RlbChyZWxhdGlvbnNoaXAsIG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCB0eXBlQ29sdW1uID0gcmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljVHlwZUNvbHVtbigpXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbdHlwZUNvbHVtbl0gfHwgdHlwZUNvbHVtblxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIGFuIGF1dGhvcml6ZWQgbmVzdGVkIHJlY29yZCBieSBpZCB3aXRob3V0IHBhcmVudCBzY29waW5nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvb2t1cCBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFyZ3MuYWJpbGl0eSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBhcmdzLmlkIC0gQ2hpbGQgaWQgZnJvbSB0aGUgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVsYXRpb25zaGlwTmFtZSAtIFBhcmVudCdzIHJlbGF0aW9uc2hpcCBuYW1lIGZvciBlcnJvciBtZXNzYWdlcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MudGFyZ2V0TW9kZWxDbGFzcyAtIENoaWxkIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IEF1dGhvcml6ZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZE5lc3RlZFJlY29yZCh7YWJpbGl0eSwgYWN0aW9uLCBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiwgaWQsIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkgfHwgdGFyZ2V0TW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBxdWVyeSA9IGFiaWxpdHlcbiAgICAgID8gdGFyZ2V0TW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKHRoaXMuX3Jlc29sdmVDaGlsZEFiaWxpdHlBY3Rpb24oY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIGFjdGlvbiksIGFiaWxpdHkpXG4gICAgICA6IHRhcmdldE1vZGVsQ2xhc3Mud2hlcmUoe30pXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBpZCkpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCAke2FjdGlvbn0gbmVzdGVkICR7cmVsYXRpb25zaGlwTmFtZX1baWQ9JHtpZH1dOiByZWNvcmQgbm90IGZvdW5kIG9yIG5vdCBhdXRob3JpemVkLmApXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFiaWxpdHkgYWN0aW9uIGZvciBhIGNoaWxkIHJlc291cmNlIHVzaW5nIHRoZSBjaGlsZCdzIG93blxuICAgKiBgYWJpbGl0aWVzYCBtYXBwaW5nIOKAlCBuZXZlciB0aGUgcGFyZW50IGNvbnRyb2xsZXIncy4gVGhpcyBwcmVzZXJ2ZXNcbiAgICogY3VzdG9tIG1hcHBpbmdzIGxpa2UgYHt1cGRhdGU6IFwibWFuYWdlXCJ9YCBhbmQgY2F0Y2hlcyB1bm1hcHBlZCBhY3Rpb25zXG4gICAqIGluc3RlYWQgb2Ygc2lsZW50bHkgZGVmYXVsdGluZyB0byB0aGUgcmF3IGFjdGlvbiBuYW1lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uIC0gQ2hpbGQgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWJpbGl0eSBhY3Rpb24gZm9yIHRoZSBjaGlsZCByZXNvdXJjZS5cbiAgICovXG4gIF9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBhY3Rpb24pIHtcbiAgICBjb25zdCBhYmlsaXRpZXMgPSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbj8uYWJpbGl0aWVzXG5cbiAgICBpZiAoIWFiaWxpdGllcyB8fCB0eXBlb2YgYWJpbGl0aWVzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYWJpbGl0aWVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgY2hpbGQgcmVzb3VyY2UgbXVzdCBkZWZpbmUgYW4gJ2FiaWxpdGllcycgb2JqZWN0IHRvIGF1dGhvcml6ZSBuZXN0ZWQgJHthY3Rpb259LmApXG4gICAgfVxuXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKGFiaWxpdGllcylbYWN0aW9uXVxuXG4gICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFiaWxpdHlBY3Rpb24ubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgY2hpbGQgcmVzb3VyY2UgbXVzdCBkZWZpbmUgYWJpbGl0aWVzLiR7YWN0aW9ufS5gKVxuICAgIH1cblxuICAgIHJldHVybiBhYmlsaXR5QWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogRmluZHMgYW4gZXhpc3RpbmcgY2hpbGQgZm9yIGEgbmVzdGVkIHVwZGF0ZS9kZXN0cm95LCBzY29wZWQgdG8gdGhlXG4gICAqIGNoaWxkJ3Mgb3duIG1vZGVsIGNsYXNzLCB0aGUgcGFyZW50J3MgZm9yZWlnbiBrZXksIEFORCB0aGUgY2hpbGRcbiAgICogcmVzb3VyY2UncyBhYmlsaXR5IG1hcHBpbmcgZm9yIHRoZSByZXF1ZXN0ZWQgYWN0aW9uLiBUaHJvd3Mgd2hlbiB0aGVcbiAgICogY2hpbGQgZG9lcyBub3QgZXhpc3QsIGRvZXMgbm90IGJlbG9uZyB0byB0aGUgY3VycmVudCBwYXJlbnQsIG9yIGlzXG4gICAqIG5vdCBhdXRob3JpemVkIOKAlCBhbGwgb2Ygd2hpY2ggbXVzdCByb2xsIHRoZSB0cmFuc2FjdGlvbiBiYWNrLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5hYmlsaXR5IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge1widXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5hY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gYXJncy5jaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbiAtIENoaWxkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGFyZ3MuaWQgLSBDaGlsZCBpZCBmcm9tIHRoZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnBhcmVudCAtIFBhcmVudCBtb2RlbCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBhcmdzLnBhcmVudExpbmtBdHRyaWJ1dGVzIC0gQXR0cmlidXRlcyB0aGF0IHNjb3BlIHRoZSBjaGlsZCB0byB0aGUgcGFyZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgKGZvciBlcnJvciBtZXNzYWdlcykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQsIHBhcmVudC1saW5rZWQgY2hpbGQgbW9kZWwuXG4gICAqL1xuICBhc3luYyBfZmluZFNjb3BlZENoaWxkKHthYmlsaXR5LCBhY3Rpb24sIGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBpZCwgcGFyZW50LCBwYXJlbnRMaW5rQXR0cmlidXRlcywgcmVsYXRpb25zaGlwTmFtZSwgdGFyZ2V0TW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSB8fCB0YXJnZXRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGxvb2t1cCA9IHsuLi5tb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKSwgLi4ucGFyZW50TGlua0F0dHJpYnV0ZXN9XG4gICAgY29uc3QgcXVlcnkgPSBhYmlsaXR5XG4gICAgICA/IHRhcmdldE1vZGVsQ2xhc3MuYWNjZXNzaWJsZUZvcih0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBhY3Rpb24pLCBhYmlsaXR5KVxuICAgICAgOiB0YXJnZXRNb2RlbENsYXNzLndoZXJlKHt9KVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBxdWVyeS5maW5kQnkobG9va3VwKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgJHthY3Rpb259IG5lc3RlZCAke3JlbGF0aW9uc2hpcE5hbWV9W2lkPSR7aWR9XTogcmVjb3JkIG5vdCBmb3VuZCwgZG9lcyBub3QgYmVsb25nIHRvIHBhcmVudCAke3BhcmVudC5nZXRNb2RlbENsYXNzKCkubmFtZX1baWQ9JHtwYXJlbnQuaWQoKX1dLCBvciBpcyBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cblxuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGFuIGFscmVhZHktc2F2ZWQgbmVzdGVkIGNoaWxkIGlzIGF1dGhvcml6ZWQgdW5kZXIgdGhlIGNoaWxkXG4gICAqIHJlc291cmNlJ3Mgb3duIGBjcmVhdGVgIGFiaWxpdHkuIFJvbGxzIGJhY2sgdmlhIHRocm93biBlcnJvciB3aGVuIG5vdFxuICAgKiBhdXRob3JpemVkIHNvIHRoZSBvdXRlciB0cmFuc2FjdGlvbiBkZXN0cm95cyB0aGUgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYXJncy5hYmlsaXR5IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmNoaWxkIC0gQ2hpbGQgbW9kZWwgaW5zdGFuY2UganVzdCBjcmVhdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IGFyZ3MuY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBDaGlsZCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZWxhdGlvbnNoaXBOYW1lIC0gUGFyZW50J3MgcmVsYXRpb25zaGlwIG5hbWUgKGZvciBlcnJvciBtZXNzYWdlcykuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnRhcmdldE1vZGVsQ2xhc3MgLSBDaGlsZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfYXV0aG9yaXplQ3JlYXRlZENoaWxkKHthYmlsaXR5LCBjaGlsZCwgY2hpbGRSZXNvdXJjZUNvbmZpZ3VyYXRpb24sIHJlbGF0aW9uc2hpcE5hbWUsIHRhcmdldE1vZGVsQ2xhc3N9KSB7XG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm5cblxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSB0aGlzLl9yZXNvbHZlQ2hpbGRBYmlsaXR5QWN0aW9uKGNoaWxkUmVzb3VyY2VDb25maWd1cmF0aW9uLCBcImNyZWF0ZVwiKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBjaGlsZFJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5IHx8IHRhcmdldE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgaWRlbnRpdHkgPSByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IGNoaWxkLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gICAgY29uc3QgYXV0aG9yaXplZENoaWxkID0gYXdhaXQgdGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbiwgYWJpbGl0eSlcbiAgICAgIC5maW5kQnkobW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucyhwcmltYXJ5S2V5LCBpZGVudGl0eSkpXG5cbiAgICBpZiAoIWF1dGhvcml6ZWRDaGlsZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBOZXN0ZWQgY3JlYXRlIG9uICR7cmVsYXRpb25zaGlwTmFtZX1bJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9XSBub3QgYXV0aG9yaXplZC5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZnRlciBuZXN0ZWQgd3JpdGVzLCBwcmVsb2FkIGV2ZXJ5IHJlbGF0aW9uc2hpcCBkZWNsYXJlZCBpbiB0aGVcbiAgICogcGFyZW50J3MgcGVybWl0IHNvIHRoZSBwb3N0LXNhdmUgc2VyaWFsaXplIHN0ZXAgZW1pdHMgdGhlbSBhbmQgdGhlXG4gICAqIGNsaWVudCBjYW4gcmVjb25jaWxlIGlkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBTYXZlZCBwYXJlbnQgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IHBlcm1pdCAtIFBhcnNlZCBwYXJlbnQgcGVybWl0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9wcmVsb2FkTmVzdGVkV3JpdGFibGVSZWxhdGlvbnNoaXBzKG1vZGVsLCBwZXJtaXQpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lcyA9IE9iamVjdC5rZXlzKHBlcm1pdC5uZXN0ZWQpXG5cbiAgICBpZiAocmVsYXRpb25zaGlwTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiByZWxhdGlvbnNoaXBOYW1lcykge1xuICAgICAgYXdhaXQgbW9kZWwubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFBhcnNlcyB0aGUgUmFpbHMvYXBpX21ha2VyLXN0eWxlIGZsYXQgcGVybWl0IHNwZWMgcmV0dXJuZWQgZnJvbVxuICogYHBlcm1pdHRlZFBhcmFtcyhhcmcpYCBpbnRvIGEgc3RydWN0dXJlZCBzaGFwZSB1c2VkIGludGVybmFsbHkgYnkgdGhlXG4gKiB3cml0ZSBwaXBlbGluZS4gU3RyaW5ncyBiZWNvbWUgYXR0cmlidXRlIHBlcm1pdHM7IG9iamVjdHMgd2hvc2Uga2V5c1xuICogZW5kIGluIGBBdHRyaWJ1dGVzYCBiZWNvbWUgbmVzdGVkIHBlcm1pdHMgKHRoZSBrZXkgcHJlZml4IG5hbWVzIHRoZVxuICogcmVsYXRpb25zaGlwKS5cbiAqXG4gKiAgIHBhcnNlUGVybWl0dGVkUGFyYW1zKFtcImZpcnN0TmFtZVwiLCBcImxhc3ROYW1lXCIsXG4gKiAgICAge3Rhc2tzQXR0cmlidXRlczogW1wiaWRcIiwgXCJfZGVzdHJveVwiLCBcIm5hbWVcIl19XG4gKiAgIF0pXG4gKiAgIC8vIOKGkiB7XG4gKiAgIC8vICAgYXR0cmlidXRlczogW1wiZmlyc3ROYW1lXCIsIFwibGFzdE5hbWVcIl0sXG4gKiAgIC8vICAgbmVzdGVkOiB7XG4gKiAgIC8vICAgICB0YXNrczoge2F0dHJpYnV0ZXM6IFtcImlkXCIsIFwiX2Rlc3Ryb3lcIiwgXCJuYW1lXCJdLCBuZXN0ZWQ6IHt9fVxuICogICAvLyAgIH1cbiAqICAgLy8gfVxuICogQHBhcmFtIHtBcnJheTxzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+IHwgdW5kZWZpbmVkfSBwZXJtaXRTcGVjIC0gRmxhdCBwZXJtaXQgc3BlYy5cbiAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogc3RyaW5nW10sIG5lc3RlZDogUmVjb3JkPHN0cmluZywge2F0dHJpYnV0ZXM6IHN0cmluZ1tdLCBuZXN0ZWQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fX0gLSBQYXJzZWQgc3RydWN0dXJlLlxuICovXG5mdW5jdGlvbiBwYXJzZVBlcm1pdHRlZFBhcmFtcyhwZXJtaXRTcGVjKSB7XG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBbXVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthdHRyaWJ1dGVzOiBzdHJpbmdbXSwgbmVzdGVkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgY29uc3QgbmVzdGVkID0ge31cblxuICBpZiAoIUFycmF5LmlzQXJyYXkocGVybWl0U3BlYykpIHJldHVybiB7YXR0cmlidXRlcywgbmVzdGVkfVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgcGVybWl0U3BlYykge1xuICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGF0dHJpYnV0ZXMucHVzaChlbnRyeSlcbiAgICB9IGVsc2UgaWYgKGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShlbnRyeSkpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGVudHJ5KSkge1xuICAgICAgICBpZiAoIWtleS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBuZXN0ZWQgcmVsYXRpb25zaGlwIGtleXMgbXVzdCBlbmQgaW4gXCJBdHRyaWJ1dGVzXCIgKGdvdCBcIiR7a2V5fVwiKS4gVXNlIFwiJHtrZXl9QXR0cmlidXRlc1wiIGluc3RlYWQuYClcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0ga2V5LnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeTogZW1wdHkgcmVsYXRpb25zaGlwIG5hbWUgaW4ga2V5IFwiJHtrZXl9XCIuYClcbiAgICAgICAgfVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlcm1pdHRlZFBhcmFtcyBlbnRyeSBmb3IgXCIke2tleX1cIjogZXhwZWN0ZWQgYXJyYXkgcGVybWl0IHNwZWMsIGdvdCAke3R5cGVvZiB2YWx1ZX0uYClcbiAgICAgICAgfVxuXG4gICAgICAgIG5lc3RlZFtyZWxhdGlvbnNoaXBOYW1lXSA9IHBhcnNlUGVybWl0dGVkUGFyYW1zKHZhbHVlKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcGVybWl0dGVkUGFyYW1zIGVudHJ5OiBleHBlY3RlZCBzdHJpbmcgb3IgbmVzdGVkLWF0dHJpYnV0ZXMgb2JqZWN0LCBnb3QgJHt0eXBlb2YgZW50cnl9LmApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHthdHRyaWJ1dGVzLCBuZXN0ZWR9XG59XG5cbi8qKlxuICogTG9jYXRlcyB3aGljaCBwcm90b3R5cGUgb3ducyBhIG1ldGhvZCBpbXBsZW1lbnRhdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBpbnN0YW5jZSAtIEluc3RhbmNlIHJlY2VpdmluZyB0aGUgbWV0aG9kLlxuICogQHBhcmFtIHtzdHJpbmd9IG1ldGhvZE5hbWUgLSBNZXRob2QgbmFtZS5cbiAqIEByZXR1cm5zIHtvYmplY3QgfCBudWxsfSAtIFByb3RvdHlwZSB0aGF0IG93bnMgdGhlIG1ldGhvZC5cbiAqL1xuZnVuY3Rpb24gcHJvdG90eXBlT3duZXJGb3JNZXRob2QoaW5zdGFuY2UsIG1ldGhvZE5hbWUpIHtcbiAgbGV0IHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihpbnN0YW5jZSlcblxuICB3aGlsZSAocHJvdG90eXBlKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwcm90b3R5cGUsIG1ldGhvZE5hbWUpKSByZXR1cm4gcHJvdG90eXBlXG5cbiAgICBwcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YocHJvdG90eXBlKVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBSdW5zIGZpbHRlciB3cml0YWJsZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJlY2VpdmVyIC0gTW9kZWwgaW5zdGFuY2Ugb3IgcHJvdG90eXBlLlxuICogQHBhcmFtIHtXcml0YWJsZUF0dHJpYnV0ZVJlY2VpdmVyQ2xhc3N9IHJlY2VpdmVyQ2xhc3MgLSBTdGF0aWMgaGVscGVyIG93bmVyIGZvciB0aGUgcmVjZWl2ZXIuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEluY29taW5nIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZXMuXG4gKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgfCBudWxsfSBbcmVzb3VyY2VdIC0gUmVzb3VyY2UgaW5zdGFuY2UgZm9yIHZpcnR1YWwtc2V0dGVyIGRldGVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nW10gfCBudWxsfSBbcGVybWl0dGVkQXR0cmlidXRlTmFtZXNdIC0gT3B0aW9uYWwgZXhwbGljaXQgcGVybWl0IGxpc3QuIGBudWxsYCBmYWxscyBiYWNrIHRvIHNldHRlci1leGlzdGVuY2UgY2hlY2tzIG9ubHkuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFdyaXRhYmxlIGF0dHJpYnV0ZXMgb25seS5cbiAqL1xuZnVuY3Rpb24gZmlsdGVyV3JpdGFibGVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhcbiAgcmVjZWl2ZXIsXG4gIHJlY2VpdmVyQ2xhc3MsXG4gIGF0dHJpYnV0ZXMsXG4gIHJlc291cmNlID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHwgbnVsbH0gKi8gKG51bGwpLFxuICBwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcyA9IG51bGxcbikge1xuICAvLyBGcm9udGVuZC1tb2RlbCB3cml0ZXMgc2hvdWxkIGZhaWwgZmFzdCB3aGVuIGNhbGxlcnMgc3VibWl0IHJlYWQtb25seSBvciB1bmtub3duIGF0dHJzLlxuICAvLyBTaWxlbnQgZHJvcHMgaGlkZSBjb250cmFjdCBtaXN0YWtlcyBpbiBnZW5lcmF0ZWQgbW9kZWxzIGFuZCBhcHAtc2lkZSB3cmFwcGVyIGNvZGUuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCB3cml0YWJsZUF0dHJpYnV0ZXMgPSB7fVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBpbnZhbGlkQXR0cmlidXRlcyA9IFtdXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGNvbnN0IG5vdFBlcm1pdHRlZEF0dHJpYnV0ZXMgPSBbXVxuXG4gIGNvbnN0IHBlcm1pdFNldCA9IEFycmF5LmlzQXJyYXkocGVybWl0dGVkQXR0cmlidXRlTmFtZXMpID8gbmV3IFNldChwZXJtaXR0ZWRBdHRyaWJ1dGVOYW1lcykgOiBudWxsXG4gIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gIGxldCB0cmFuc2xhdGVkQXR0cmlidXRlcyA9IFtdXG5cbiAgaWYgKHJlc291cmNlKSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2V9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcblxuICAgIHRyYW5zbGF0ZWRBdHRyaWJ1dGVzID0gUmVzb3VyY2VDbGFzcy50cmFuc2xhdGVkQXR0cmlidXRlc0NvbmZpZygpIHx8IFtdXG4gIH1cblxuICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldCh0cmFuc2xhdGVkQXR0cmlidXRlcylcblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAocGVybWl0U2V0ICYmICFwZXJtaXRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICBub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLnB1c2goYXR0cmlidXRlTmFtZSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gcmVjZWl2ZXJDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB8fCBhdHRyaWJ1dGVOYW1lXG4gICAgY29uc3QgcmVxdWVzdGVkU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKX1gXG4gICAgY29uc3Qgc2V0dGVyTmFtZSA9IHJlY2VpdmVyQ2xhc3MuZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZShyZWNlaXZlciwgcmVxdWVzdGVkU2V0dGVyTmFtZSkgfHwgcmVxdWVzdGVkU2V0dGVyTmFtZVxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoYXR0cmlidXRlTmFtZSl9QXR0cmlidXRlYFxuICAgIGNvbnN0IHJlc291cmNlU2V0dGVyID0gcmVzb3VyY2U/LnJlc291cmNlTWV0aG9kKHJlc291cmNlU2V0dGVyTmFtZSlcblxuICAgIGlmIChzZXR0ZXJOYW1lIGluIHJlY2VpdmVyKSB7XG4gICAgICB3cml0YWJsZUF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSBpZiAocmVzb3VyY2VTZXR0ZXIpIHtcbiAgICAgIHdyaXRhYmxlQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIGlmICh0cmFuc2xhdGVkU2V0LmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgd3JpdGFibGVBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2Uge1xuICAgICAgaW52YWxpZEF0dHJpYnV0ZXMucHVzaChhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgfVxuXG4gIGlmIChub3RQZXJtaXR0ZWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBGcm9udGVuZCBtb2RlbCB3cml0ZSBhdHRyaWJ1dGVzIG5vdCBwZXJtaXR0ZWQgYnkgcGVybWl0dGVkUGFyYW1zKCk6ICR7bm90UGVybWl0dGVkQXR0cmlidXRlcy5qb2luKFwiLCBcIil9YCwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtYXR0cmlidXRlLWVycm9yXCJ9KVxuICB9XG5cbiAgaWYgKGludmFsaWRBdHRyaWJ1dGVzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBJbnZhbGlkIGZyb250ZW5kIG1vZGVsIHdyaXRlIGF0dHJpYnV0ZXM6ICR7aW52YWxpZEF0dHJpYnV0ZXMuam9pbihcIiwgXCIpfWAsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLWF0dHJpYnV0ZS1lcnJvclwifSlcbiAgfVxuXG4gIHJldHVybiB3cml0YWJsZUF0dHJpYnV0ZXNcbn1cbiJdfQ==