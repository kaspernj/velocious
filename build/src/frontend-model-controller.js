// @ts-check
import { randomUUID } from "node:crypto";
import * as inflection from "inflection";
import Controller from "./controller.js";
import FrontendModelBaseResource from "./frontend-model-resource/base-resource.js";
import Response from "./http-server/client/response.js";
import { frontendModelResourcesWithBuiltInsForBackendProject } from "./frontend-models/built-in-resources.js";
import { frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition, frontendModelResourcePath, frontendModelResourcesForBackendProject, frontendModelSyncManifestForBackendProjects } from "./frontend-models/resource-definition.js";
import { createOfflineGrantFromBootstrap, verifyOfflineGrant } from "./sync/offline-grant.js";
import { serverChangeFeedStoreForConfiguration } from "./sync/server-change-feed.js";
import { mutationIdempotencyKey, verifySignedMutation } from "./sync/device-identity.js";
import { FrontendModelQueryError, normalizeGroup as normalizeQueryGroup, normalizeJoins as normalizeQueryJoins, normalizePluck as normalizeQueryPluck, normalizePreload as normalizeQueryPreload, normalizeSearchOperator as normalizeQuerySearchOperator, normalizeSort as normalizeQuerySort } from "./frontend-models/query.js";
import { assignSafeProperty, deserializeFrontendModelTransportValue, isBackendModelInstance, serializeFrontendModelTransportValue } from "./frontend-models/transport-serialization.js";
import { requestDetails } from "./error-reporting/request-details.js";
import RoutesResolver from "./routes/resolver.js";
import { ValidationError } from "./database/record/index.js";
import RecordNotFoundError from "./database/record/record-not-found-error.js";
import { captureFrontendModelRemoteRequestContext, mergeFrontendModelRemoteRequestContext } from "./frontend-models/remote-request-context.js";
import { normalizeDateStringForWrite } from "./database/datetime-storage.js";
import VelociousError from "./velocious-error.js";
import isDate from "./utils/is-date.js";
import isPlainObject from "./utils/plain-object.js";
import { RansackQueryError, normalizeRansackGroup, parseRansackSort } from "./utils/ransack.js";
/**
 * FrontendModelSearch type.
 * @typedef {object} FrontendModelSearch
 * @property {string[]} path - Relationship path.
 * @property {string} column - Column or attribute name.
 * @property {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {ReturnType<typeof JSON.parse>} value - Search value.
 */
/**
 * FrontendModelSort type.
 * @typedef {object} FrontendModelSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */
/**
 * FrontendModelGroup type.
 * @typedef {object} FrontendModelGroup
 * @property {string} column - Attribute name to group by.
 * @property {string[]} path - Relationship path from root model.
 */
/**
 * FrontendModelPluck type.
 * @typedef {object} FrontendModelPluck
 * @property {string} column - Attribute name to pluck.
 * @property {string[]} path - Relationship path from root model.
 */
/**
 * FrontendModelPagination type.
 * @typedef {object} FrontendModelPagination
 * @property {number | null} limit - Maximum number of records.
 * @property {number | null} offset - Number of records to skip.
 * @property {number | null} page - 1-based page number.
 * @property {number | null} perPage - Page size.
 */
/**
 * @typedef {import("./configuration-types.js").ClientErrorPayloadContext & {
 *   action: string,
 *   expectedError: boolean,
 *   frontendModelEndpoint: true
 * }} FrontendModelEndpointErrorContext
 */
/**
 * FrontendModelIndexQueryOptions type.
 * @typedef {object} FrontendModelIndexQueryOptions
 * @property {boolean} [includePagination] - Whether frontend-model pagination params should be applied.
 * @property {boolean} [includeSort] - Whether frontend-model sort params should be applied.
 * @property {import("./frontend-model-resource/base-resource.js").default} [resource] - Resource providing query hooks.
 */
/** @typedef {import("./database/query/model-class-query.js").default & Record<symbol, Set<string> | undefined>} FrontendModelQueryMetadata */
/**
 * @callback FrontendModelSerializationResourceInstanceHook
 * @param {import("./database/record/index.js").default} model - Model instance being serialized.
 * @param {import("./frontend-model-resource/base-resource.js").default | null} resource - Resolved serialization resource instance, if any.
 * @returns {void}
 */
/**
 * Runs normalize frontend model preload.
 * @param {import("./database/query/index.js").NestedPreloadRecord | string | string[] | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Normalized preload.
 */
function normalizeFrontendModelPreload(preload) {
    if (!preload)
        return null;
    try {
        return normalizeQueryPreload(preload);
    }
    catch (error) {
        return throwFrontendModelQueryErrorForParserError(error);
    }
}
/**
 * Runs normalize frontend model joins.
 * @param {ReturnType<typeof JSON.parse>} joins - Joins payload.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Normalized relationship-object joins.
 */
function normalizeFrontendModelJoins(joins) {
    if (!joins)
        return null;
    try {
        return normalizeQueryJoins(joins);
    }
    catch (error) {
        return throwFrontendModelQueryErrorForParserError(error);
    }
}
/**
 * Runs normalize frontend model select.
 * @param {ReturnType<typeof JSON.parse>} select - Select payload.
 * @param {string | null} [rootModelName] - Optional root model name for shorthand payloads.
 * @returns {Record<string, string[]> | null} - Normalized model-name keyed select record.
 */
function normalizeFrontendModelSelect(select, rootModelName = null) {
    if (!select)
        return null;
    if (typeof select === "string") {
        if (!rootModelName) {
            throw frontendModelQueryError("Invalid select shorthand without root model name");
        }
        return { [rootModelName]: [select] };
    }
    if (Array.isArray(select)) {
        if (!rootModelName) {
            throw frontendModelQueryError("Invalid select shorthand without root model name");
        }
        for (const attributeName of select) {
            if (typeof attributeName !== "string") {
                throw frontendModelQueryError(`Invalid select attribute for ${rootModelName}: ${typeof attributeName}`);
            }
        }
        return { [rootModelName]: Array.from(new Set(select)) };
    }
    if (!isPlainObject(select)) {
        throw frontendModelQueryError(`Invalid select type: ${typeof select}`);
    }
    /**
     * Normalized.
     * @type {Record<string, string[]>} */
    const normalized = {};
    for (const [modelName, selectValue] of Object.entries(select)) {
        if (typeof selectValue === "string") {
            normalized[modelName] = [selectValue];
            continue;
        }
        if (!Array.isArray(selectValue)) {
            throw frontendModelQueryError(`Invalid select value for ${modelName}: ${typeof selectValue}`);
        }
        for (const attributeName of selectValue) {
            if (typeof attributeName !== "string") {
                throw frontendModelQueryError(`Invalid select attribute for ${modelName}: ${typeof attributeName}`);
            }
        }
        normalized[modelName] = Array.from(new Set(selectValue));
    }
    return normalized;
}
const frontendModelJoinedPathsSymbol = Symbol("frontendModelJoinedPaths");
const frontendModelGroupedColumnsSymbol = Symbol("frontendModelGroupedColumns");
const frontendModelWhereNoMatchSymbol = Symbol("frontendModelWhereNoMatch");
const frontendModelClientSafeErrorMessage = "Request failed.";
/**
 * Builds a client-safe sync replay validation error.
 * @param {string} message - Client-safe validation message.
 * @param {unknown} [cause] - Original cause.
 * @returns {VelociousError} - Client-safe replay error.
 */
function frontendSyncReplaySafeError(message, cause) {
    return VelociousError.safe(message, {
        cause,
        code: "frontend_sync_replay_error"
    });
}
/**
 * Runs frontend model query metadata.
 * @param {import("./database/query/model-class-query.js").default} query - Query instance.
 * @returns {FrontendModelQueryMetadata} - Query metadata access helper.
 */
function frontendModelQueryMetadata(query) {
    return /** @type {FrontendModelQueryMetadata} */ (query);
}
/**
 * Builds a client-safe frontend-model query error.
 * @param {string} message - Error message.
 * @returns {VelociousError} Client-safe query error.
 */
function frontendModelQueryError(message) {
    return VelociousError.safe(message, { code: "frontend-model-query-error" });
}
/**
 * Throws a client-safe frontend-model query error for typed query parser errors.
 * @param {ReturnType<typeof JSON.parse>} error - Error raised while normalizing client query params.
 * @returns {never} Always throws.
 */
function throwFrontendModelQueryErrorForParserError(error) {
    if (error instanceof FrontendModelQueryError || error instanceof RansackQueryError) {
        throw frontendModelQueryError(error.message);
    }
    throw error;
}
/**
 * Whether the error carries an `error.velocious` metadata bag. The
 * presence of any such bag marks the error as "annotated by the
 * developer for the frontend" — the framework treats it as
 * user-facing: surface the message, forward the metadata, and skip
 * the noisy endpoint-error log.
 * @param {unknown} error - Caught error.
 * @returns {boolean} Whether the error has Velocious frontend metadata.
 */
function frontendModelErrorHasVelociousMetadata(error) {
    if (!error || typeof error !== "object")
        return false;
    // Runtime checks above narrow this caught value to the metadata record shape.
    const errorRecord = /** @type {{velocious?: import("./configuration-types.js").ClientErrorPayloadReporterPayload}} */ (error);
    return isPlainObject(errorRecord.velocious);
}
/**
 * Whether the error is an expected frontend-model user-flow failure.
 * @param {unknown} error - Caught error.
 * @returns {boolean} Whether the error is expected.
 */
function frontendModelExpectedError(error) {
    if (error instanceof RecordNotFoundError)
        return true;
    if (error instanceof ValidationError)
        return true;
    if (error instanceof VelociousError && error.safeToExpose)
        return true;
    if (frontendModelErrorHasVelociousMetadata(error))
        return true;
    return false;
}
/**
 * Runs frontend model velocious metadata for error.
 * @param {unknown} error - Caught error.
 * @returns {import("./configuration-types.js").ClientErrorPayloadReporterPayload | null} Frontend-model Velocious metadata when present.
 */
function frontendModelVelociousMetadataForError(error) {
    const errorCode = error instanceof VelociousError && error.safeToExpose && typeof error.code === "string" && error.code.length > 0
        ? error.code
        : null;
    if (!frontendModelErrorHasVelociousMetadata(error)) {
        return errorCode ? { code: errorCode } : null;
    }
    // frontendModelErrorHasVelociousMetadata guards the caught value before this cast.
    const errorRecord = /** @type {{velocious: import("./configuration-types.js").ClientErrorPayloadReporterPayload}} */ (error);
    const metadata = errorRecord.velocious;
    return errorCode ? { ...metadata, code: errorCode } : metadata;
}
/**
 * Runs frontend model client message for error.
 * @param {unknown} error - Caught error.
 * @param {boolean} exposeInternalErrorsToClients - Whether unexpected error messages may be exposed.
 * @returns {string} - Message safe to return to API clients.
 */
function frontendModelClientMessageForError(error, exposeInternalErrorsToClients) {
    if (error instanceof RecordNotFoundError) {
        return "Record not found.";
    }
    if (error instanceof VelociousError && error.safeToExpose) {
        return error.message;
    }
    // Validation failures are expected user-flow errors. Always forward the
    // validation summary so the client shows the real reason (e.g. "Name can't
    // be blank") instead of the generic "Request failed." message, regardless of
    // whether the raising code also attached error.velocious metadata.
    if (error instanceof ValidationError) {
        return error.message;
    }
    if (frontendModelErrorHasVelociousMetadata(error) && error instanceof Error) {
        return error.message;
    }
    if (exposeInternalErrorsToClients && error instanceof Error)
        return error.message;
    return frontendModelClientSafeErrorMessage;
}
/**
 * Runs frontend model debug payload for error.
 * @param {object} args - Arguments.
 * @param {import("./configuration.js").default} args.configuration - Current configuration.
 * @param {unknown} args.error - Caught error.
 * @returns {import("./configuration-types.js").ClientErrorPayloadReporterPayload} - Optional internal error details when client exposure is enabled.
 */
function frontendModelDebugPayloadForError({ configuration, error }) {
    if (!configuration.getExposeInternalErrorsToClients()) {
        return {};
    }
    if (error instanceof VelociousError && error.safeToExpose) {
        return {};
    }
    if (error instanceof RecordNotFoundError) {
        return {};
    }
    if (frontendModelErrorHasVelociousMetadata(error)) {
        return {};
    }
    const debugErrorClass = error instanceof Error && error.name
        ? error.name
        : typeof error;
    const debugErrorMessage = error instanceof Error
        ? error.message
        : String(error);
    const debugBacktrace = error instanceof Error && typeof error.stack === "string" && error.stack.length > 0
        ? error.stack.split("\n")
        : undefined;
    return {
        debugErrorClass,
        debugErrorMessage,
        ...(debugBacktrace ? { debugBacktrace } : {})
    };
}
/**
 * Runs normalize frontend model searches.
 * @param {ReturnType<typeof JSON.parse>} searches - Search payload.
 * @returns {FrontendModelSearch[]} - Normalized searches.
 */
function normalizeFrontendModelSearches(searches) {
    if (!searches)
        return [];
    if (!Array.isArray(searches)) {
        throw frontendModelQueryError(`Invalid searches type: ${typeof searches}`);
    }
    /**
     * Normalized.
     * @type {FrontendModelSearch[]} */
    const normalized = [];
    for (const search of searches) {
        if (!isPlainObject(search)) {
            throw frontendModelQueryError(`Invalid search entry type: ${typeof search}`);
        }
        const path = search.path;
        const column = search.column;
        const operator = search.operator;
        if (!Array.isArray(path)) {
            throw frontendModelQueryError("Invalid search path: expected an array");
        }
        for (const pathEntry of path) {
            if (typeof pathEntry !== "string" || pathEntry.length < 1) {
                throw frontendModelQueryError("Invalid search path entry: expected non-empty string");
            }
        }
        if (typeof column !== "string" || column.length < 1) {
            throw frontendModelQueryError("Invalid search column: expected non-empty string");
        }
        if (typeof operator !== "string") {
            throw frontendModelQueryError(`Invalid search operator: ${operator}`);
        }
        let normalizedOperator;
        try {
            normalizedOperator = normalizeQuerySearchOperator(operator);
        }
        catch (error) {
            throwFrontendModelQueryErrorForParserError(error);
        }
        normalized.push({
            column,
            operator: normalizedOperator,
            path: [...path],
            value: search.value
        });
    }
    return normalized;
}
/**
 * Runs normalize frontend model where.
 * @param {ReturnType<typeof JSON.parse>} where - Where payload.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Normalized where hash.
 */
function normalizeFrontendModelWhere(where) {
    if (!where)
        return null;
    if (!isPlainObject(where)) {
        throw frontendModelQueryError(`Invalid where type: ${typeof where}`);
    }
    return where;
}
/**
 * Runs normalize frontend model ransack.
 * @param {ReturnType<typeof JSON.parse>} ransack - Ransack payload.
 * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Normalized Ransack hash.
 */
function normalizeFrontendModelRansack(ransack) {
    if (!ransack)
        return null;
    if (!isPlainObject(ransack)) {
        throw frontendModelQueryError(`Invalid ransack type: ${typeof ransack}`);
    }
    return ransack;
}
/**
 * Runs normalize frontend model integer param.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate integer.
 * @param {string} name - Param name for errors.
 * @param {number} min - Minimum allowed value.
 * @returns {number | null} - Normalized integer.
 */
function normalizeFrontendModelIntegerParam(value, name, min) {
    if (value == null)
        return null;
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw frontendModelQueryError(`Invalid ${name}: expected integer number`);
    }
    if (value < min) {
        throw frontendModelQueryError(`Invalid ${name}: expected value >= ${min}`);
    }
    return value;
}
/**
 * Runs normalize frontend model pagination.
 * @param {object} args - Pagination args.
 * @param {ReturnType<typeof JSON.parse>} args.limit - Limit payload.
 * @param {ReturnType<typeof JSON.parse>} args.offset - Offset payload.
 * @param {ReturnType<typeof JSON.parse>} args.page - Page payload.
 * @param {ReturnType<typeof JSON.parse>} args.perPage - Per-page payload.
 * @returns {FrontendModelPagination} - Normalized pagination data.
 */
function normalizeFrontendModelPagination({ limit, offset, page, perPage }) {
    return {
        limit: normalizeFrontendModelIntegerParam(limit, "limit", 0),
        offset: normalizeFrontendModelIntegerParam(offset, "offset", 0),
        page: normalizeFrontendModelIntegerParam(page, "page", 1),
        perPage: normalizeFrontendModelIntegerParam(perPage, "perPage", 1)
    };
}
/**
 * Runs normalize frontend model distinct.
 * @param {ReturnType<typeof JSON.parse>} distinct - Distinct payload.
 * @returns {boolean | null} - Normalized distinct flag when provided.
 */
function normalizeFrontendModelDistinct(distinct) {
    if (distinct == null)
        return null;
    if (typeof distinct !== "boolean") {
        throw frontendModelQueryError(`Invalid distinct: expected boolean`);
    }
    return distinct;
}
/**
 * Runs build frontend model join object from path.
 * @param {string[]} path - Relationship path.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Join object.
 */
function buildFrontendModelJoinObjectFromPath(path) {
    /**
     * Join object.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const joinObject = {};
    /**
     * Current node.
     * @type {Record<string, ReturnType<typeof JSON.parse>>} */
    let currentNode = joinObject;
    for (const relationshipName of path) {
        currentNode[relationshipName] = {};
        currentNode = currentNode[relationshipName];
    }
    return joinObject;
}
/**
 * Build a successful single-model frontend-model response payload.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} model - Serialized model payload.
 * @returns {{model: Record<string, ReturnType<typeof JSON.parse>>, status: "success"}} - Success response payload.
 */
function frontendModelSerializedModelSuccess(model) {
    return { model, status: "success" };
}
/**
 * Resolve and validate attachment params shared by attachment commands.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Frontend-model request params.
 * @returns {{attachmentId: string | undefined, attachmentName: string} | string} - Attachment params or validation error message.
 */
function frontendModelAttachmentParams(params) {
    const attachmentName = params.attachmentName;
    if (typeof attachmentName !== "string" || attachmentName.length < 1) {
        return "Expected attachmentName.";
    }
    return {
        attachmentId: typeof params.attachmentId === "string" ? params.attachmentId : undefined,
        attachmentName
    };
}
/**
 * Extract mutation attributes shared by create and update commands.
 * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Frontend-model request params.
 * @returns {{attributes: Record<string, ReturnType<typeof JSON.parse>>, attachments: Record<string, ReturnType<typeof JSON.parse>> | null, nestedAttributes: Record<string, ReturnType<typeof JSON.parse>> | null} | string} - Mutation attributes or validation error message.
 */
function frontendModelMutationAttributes(params) {
    const attributes = params.attributes;
    if (!isPlainObject(attributes)) {
        return "Expected model attributes.";
    }
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const regularAttributes = {};
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const nestedAttributes = {};
    for (const [attributeName, value] of Object.entries(attributes)) {
        if (attributeName.endsWith("Attributes")) {
            const relationshipName = attributeName.slice(0, -"Attributes".length);
            if (!relationshipName)
                return `Invalid nested attributes key: ${attributeName}`;
            nestedAttributes[relationshipName] = value;
        }
        else {
            regularAttributes[attributeName] = value;
        }
    }
    if (params.nestedAttributes !== undefined) {
        if (!isPlainObject(params.nestedAttributes))
            return "Expected nestedAttributes to be an object.";
        Object.assign(nestedAttributes, params.nestedAttributes);
    }
    if (params.attachments !== undefined && !isPlainObject(params.attachments)) {
        return "Expected attachments to be an object.";
    }
    return {
        attributes: regularAttributes,
        attachments: params.attachments === undefined ? null : params.attachments,
        nestedAttributes: Object.keys(nestedAttributes).length > 0 ? nestedAttributes : null
    };
}
/** Controller with built-in frontend model resource actions. */
export default class FrontendModelController extends Controller {
    /**
     * Frontend model params.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
    _frontendModelParams = undefined;
    /**
     * Frontend model params override.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
    _frontendModelParamsOverride = undefined;
    /**
     * Frontend model ability override.
     * @type {import("./authorization/ability.js").default | undefined} */
    _frontendModelAbilityOverride = undefined;
    /**
     * Original deserialized custom-command client payload, captured before route
     * framework params are merged in, so a typed command method receives the client's
     * own arguments rather than the route metadata. Only set on the shared-endpoint path.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
    _frontendModelCustomCommandClientArguments = undefined;
    /**
     * Request-scoped cache for serialization resource instances.
     * Keyed by model class, then by whether the resource is for a related model
     * (so self-referential relationships do not accidentally reuse root params).
     * @type {Map<typeof import("./database/record/index.js").default, Map<boolean, import("./frontend-model-resource/base-resource.js").default>> | undefined} */
    _frontendModelSerializationResourceInstances = undefined;
    /**
     * Optional per-instance hook invoked for every serialization resource instance
     * resolution. Intended for tests and benchmarks; absent in production.
     * @type {FrontendModelSerializationResourceInstanceHook | null | undefined} */
    _frontendModelSerializationResourceInstanceHook = undefined;
    /**
     * Runs frontend model params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Decoded request params.
     */
    frontendModelParams() {
        if (this._frontendModelParamsOverride) {
            return this._frontendModelParamsOverride;
        }
        this._frontendModelParams ||= /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(this.params()));
        return this._frontendModelParams;
    }
    /**
     * Runs with frontend model params.
     * @template T
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Temporary frontend model params.
     * @param {() => Promise<T>} callback - Callback executed with temporary params.
     * @returns {Promise<T>} - Callback return value.
     */
    async withFrontendModelParams(params, callback) {
        const previousOverride = this._frontendModelParamsOverride;
        const previousParams = this._frontendModelParams;
        const previousSerializationResourceInstances = this._frontendModelSerializationResourceInstances;
        this._frontendModelParamsOverride = params;
        this._frontendModelParams = undefined;
        this._frontendModelSerializationResourceInstances = undefined;
        try {
            return await callback();
        }
        finally {
            this._frontendModelParamsOverride = previousOverride;
            this._frontendModelParams = previousParams;
            this._frontendModelSerializationResourceInstances = previousSerializationResourceInstances;
        }
    }
    /**
     * Runs with frontend model request context.
     * @template T
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request-scoped params.
     * @param {import("./http-server/client/response.js").default} response - Response instance.
     * @param {() => Promise<T>} callback - Callback executed inside resolved tenant and ability context.
     * @returns {Promise<T>} - Callback return value.
     */
    async withFrontendModelRequestContext(params, response, callback) {
        const configuration = this.getConfiguration();
        const tenant = configuration.getTenantResolver()
            ? await configuration.ensureConnections({ name: "Frontend model request tenant resolution" }, async () => {
                return await configuration.resolveTenant({
                    params,
                    request: this.request(),
                    response
                });
            })
            : undefined;
        return await configuration.runWithTenant(tenant, async () => {
            return await configuration.ensureConnections({ name: "Frontend model request" }, async () => {
                const ability = await configuration.resolveAbility({
                    params,
                    request: this.request(),
                    response
                });
                /**
                 * Previous ability override.
                 * @type {import("./authorization/ability.js").default | undefined} */
                const previousAbilityOverride = this._frontendModelAbilityOverride;
                this._frontendModelAbilityOverride = ability;
                try {
                    return await configuration.runWithAbility(ability, async () => {
                        return await callback();
                    });
                }
                finally {
                    this._frontendModelAbilityOverride = previousAbilityOverride;
                }
            });
        });
    }
    /**
     * Runs current ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability for frontend-model request scope.
     */
    currentAbility() {
        return this._frontendModelAbilityOverride || super.currentAbility();
    }
    /**
     * Runs frontend model class.
     * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
     */
    frontendModelClass() {
        const frontendModelClass = this.frontendModelClassFromConfiguration();
        const params = this.frontendModelParams();
        const modelName = typeof params.model === "string" ? params.model : undefined;
        const controllerName = typeof params.controller === "string" ? params.controller : undefined;
        if (frontendModelClass)
            return frontendModelClass;
        throw new Error(`No frontend model configured for model '${modelName || "unknown"}' and controller '${controllerName || "unknown"}'. Ensure a FrontendModelBaseResource subclass exists in src/resources/ or is listed in the ability resolver.`);
    }
    /**
     * Runs frontend model resource configuration.
     * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
     */
    frontendModelResourceConfiguration() {
        const params = this.frontendModelParams();
        const modelName = typeof params.model === "string" ? params.model : undefined;
        const controllerName = typeof params.controller === "string" ? params.controller : undefined;
        const backendProjects = this.getConfiguration().getBackendProjects();
        for (const backendProject of backendProjects) {
            const resources = frontendModelResourcesWithBuiltInsForBackendProject(backendProject);
            if (modelName && modelName.length > 0 && resources[modelName]) {
                const resourceDefinition = resources[modelName];
                const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
                const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
                if (!resourceConfiguration || !resourceClass) {
                    throw new Error(`Frontend model resource '${modelName}' must be a FrontendModelBaseResource subclass`);
                }
                return {
                    backendProject,
                    modelName,
                    resourceClass,
                    resourceConfiguration
                };
            }
            if (!controllerName || controllerName.length < 1)
                continue;
            for (const resourceModelName in resources) {
                const resourceDefinition = resources[resourceModelName];
                const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
                const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
                if (!resourceConfiguration || !resourceClass) {
                    throw new Error(`Frontend model resource '${resourceModelName}' must be a FrontendModelBaseResource subclass`);
                }
                const resourcePath = this.frontendModelResourcePath(resourceModelName, resourceDefinition);
                if (this.frontendModelResourceMatchesController({ controllerName, resourcePath })) {
                    return {
                        backendProject,
                        modelName: resourceModelName,
                        resourceClass,
                        resourceConfiguration
                    };
                }
            }
        }
        return null;
    }
    /**
     * Runs frontend model resource configuration for backend project model name.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {string} args.modelName - Model name.
     * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model name.
     */
    frontendModelResourceConfigurationForBackendProjectModelName({ backendProject, modelName }) {
        const resources = frontendModelResourcesWithBuiltInsForBackendProject(backendProject);
        const resourceDefinition = resources[modelName];
        if (!resourceDefinition)
            return null;
        const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition);
        const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
        if (!resourceConfiguration || !resourceClass)
            return null;
        return {
            backendProject,
            modelName,
            resourceClass,
            resourceConfiguration
        };
    }
    /**
     * Runs frontend model resource configuration for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model class.
     */
    frontendModelResourceConfigurationForModelClass(modelClass) {
        const frontendModelResource = this.frontendModelResourceConfiguration();
        if (!frontendModelResource)
            return null;
        return this.frontendModelResourceConfigurationForBackendProjectModelName({
            backendProject: frontendModelResource.backendProject,
            modelName: modelClass.getModelName()
        });
    }
    /**
     * Runs frontend model resource model class.
     * @param {{modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType}} frontendModelResource - Frontend model resource configuration.
     * @returns {typeof import("./database/record/index.js").default} - Backing record class.
     */
    frontendModelResourceModelClass(frontendModelResource) {
        return frontendModelResource.resourceClass.modelClass();
    }
    /**
     * Runs frontend model class from configuration.
     * @returns {typeof import("./database/record/index.js").default | null} - Frontend model class resolved from backend project configuration.
     */
    frontendModelClassFromConfiguration() {
        const frontendModelResource = this.frontendModelResourceConfiguration();
        if (!frontendModelResource)
            return null;
        return this.frontendModelResourceModelClass(frontendModelResource);
    }
    /**
     * Ensures the frontend model class and requested preload target classes are initialized.
     * This handles the case where model initialization was skipped at startup (e.g., browser tests).
     * @returns {Promise<void>} - Resolves when the model class is ready.
     */
    async ensureFrontendModelClassInitialized() {
        const frontendModelResource = this.frontendModelResourceConfiguration();
        const modelClass = this.frontendModelClassFromConfiguration();
        if (!modelClass)
            return;
        await this.ensureFrontendModelRecordClassInitialized(modelClass);
        if (!frontendModelResource)
            return;
        await this.ensureFrontendModelPreloadClassesInitialized({
            backendProject: frontendModelResource.backendProject,
            modelClass,
            preload: this.frontendModelPreload()
        });
    }
    /**
     * Runs ensure frontend model record class initialized.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class to initialize.
     * @returns {Promise<void>} - Resolves when the model class is ready.
     */
    async ensureFrontendModelRecordClassInitialized(modelClass) {
        if (!modelClass || modelClass.isInitialized())
            return;
        await modelClass.ensureInitialized({ configuration: this.getConfiguration() });
    }
    /**
     * Runs ensure frontend model preload classes initialized.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class whose preload tree is being resolved.
     * @param {import("./database/query/index.js").NestedPreloadRecord | null} args.preload - Normalized preload tree.
     * @returns {Promise<void>} - Resolves when preload target classes are initialized.
     */
    async ensureFrontendModelPreloadClassesInitialized({ backendProject, modelClass, preload }) {
        if (!preload)
            return;
        for (const [relationshipName, relationshipPreload] of Object.entries(preload)) {
            if (relationshipPreload === false)
                continue;
            const relationship = modelClass.getRelationshipsMap()[relationshipName];
            if (!relationship) {
                throw frontendModelQueryError(`Unknown preload relationship "${relationshipName}" for ${modelClass.name}`);
            }
            const targetModelClass = await this.ensureFrontendModelRelationshipTargetClassInitialized({
                backendProject,
                relationship
            });
            if (!targetModelClass) {
                if (isPlainObject(relationshipPreload) && Object.keys(relationshipPreload).length > 0) {
                    let message = `Cannot preload nested relationships through relationship "${relationshipName}" for ${modelClass.name} because its target model class could not be resolved`;
                    if (relationship.getPolymorphic() && relationship.getType() === "belongsTo") {
                        message = `Cannot preload nested relationships through polymorphic relationship "${relationshipName}" for ${modelClass.name}`;
                    }
                    throw frontendModelQueryError(message);
                }
                continue;
            }
            if (!isPlainObject(relationshipPreload))
                continue;
            await this.ensureFrontendModelPreloadClassesInitialized({
                backendProject,
                modelClass: targetModelClass,
                preload: /** @type {import("./database/query/index.js").NestedPreloadRecord} */ (relationshipPreload)
            });
        }
    }
    /**
     * Runs ensure frontend model relationship target class initialized.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {import("./database/record/relationships/base.js").default} args.relationship - Relationship definition.
     * @returns {Promise<typeof import("./database/record/index.js").default | null>} - Target model class, when available.
     */
    async ensureFrontendModelRelationshipTargetClassInitialized({ backendProject, relationship }) {
        if (relationship.through) {
            const throughRelationship = relationship.getModelClass().getRelationshipByName(relationship.through);
            await this.ensureFrontendModelRelationshipTargetClassInitialized({
                backendProject,
                relationship: throughRelationship
            });
        }
        const targetModelClass = this.frontendModelRelationshipTargetModelClass({
            backendProject,
            relationship
        });
        if (!targetModelClass)
            return null;
        await this.ensureFrontendModelRecordClassInitialized(targetModelClass);
        return targetModelClass;
    }
    /**
     * Runs frontend model relationship target model class.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {import("./database/record/relationships/base.js").default} args.relationship - Relationship definition.
     * @returns {typeof import("./database/record/index.js").default | null} - Target model class, when available.
     */
    frontendModelRelationshipTargetModelClass({ backendProject, relationship }) {
        if (relationship.getPolymorphic() && relationship.getType() === "belongsTo")
            return null;
        if (relationship.klass)
            return relationship.klass;
        if (relationship.className) {
            const frontendModelResource = this.frontendModelResourceConfigurationForBackendProjectModelName({
                backendProject,
                modelName: relationship.className
            });
            const resourceModelClass = frontendModelResource ? this.frontendModelResourceModelClass(frontendModelResource) : null;
            if (resourceModelClass)
                return resourceModelClass;
            const registeredModelClass = this.getConfiguration().getModelClasses()[relationship.className];
            if (registeredModelClass)
                return registeredModelClass;
        }
        const targetModelClass = relationship.getTargetModelClass();
        return targetModelClass || null;
    }
    /**
     * Runs frontend model resource path.
     * @param {string} modelName - Model class name.
     * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
     * @returns {string} - Normalized resource path.
     */
    frontendModelResourcePath(modelName, resourceDefinition) {
        return frontendModelResourcePath(modelName, resourceDefinition);
    }
    /**
     * Runs frontend model resource matches controller.
     * @param {object} args - Arguments.
     * @param {string} args.controllerName - Controller name from params.
     * @param {string} args.resourcePath - Resource path from configuration.
     * @returns {boolean} - Whether resource path matches current controller.
     */
    frontendModelResourceMatchesController({ controllerName, resourcePath }) {
        const normalizedController = controllerName.replace(/^\/+|\/+$/g, "");
        const normalizedResourcePath = resourcePath.replace(/^\/+|\/+$/g, "");
        if (normalizedResourcePath === normalizedController)
            return true;
        return normalizedResourcePath.endsWith(`/${normalizedController}`);
    }
    /**
     * Runs frontend model resource instance.
     * @returns {import("./frontend-model-resource/base-resource.js").default} - Backend resource instance for current frontend-model action.
     */
    frontendModelResourceInstance() {
        const frontendModelResource = this.frontendModelResourceConfiguration();
        if (!frontendModelResource) {
            throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`);
        }
        const resourceArgs = {
            ability: this.currentAbility(),
            controller: this,
            context: {
                ...(this.currentAbility()?.getContext() || {}),
                params: this.frontendModelParams(),
                request: this.request()
            },
            locals: this.currentAbility()?.getLocals() || {},
            modelClass: this.frontendModelClass(),
            modelName: frontendModelResource.modelName,
            params: this.frontendModelParams(),
            resourceConfiguration: frontendModelResource.resourceConfiguration
        };
        return new frontendModelResource.resourceClass(resourceArgs);
    }
    /**
     * Runs frontend model primary key.
     * @returns {string} - Frontend model primary key.
     */
    frontendModelPrimaryKey() {
        return this.frontendModelClass().primaryKey();
    }
    /**
     * Runs frontend model ability action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {string} - Ability action configured for the frontend action.
     */
    frontendModelAbilityAction(action) {
        const frontendModelResource = this.frontendModelResourceConfiguration();
        if (!frontendModelResource) {
            throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`);
        }
        const abilities = frontendModelResource.resourceConfiguration.abilities;
        if (!abilities || typeof abilities !== "object") {
            throw new Error(`Resource '${frontendModelResource.modelName}' must define an 'abilities' object`);
        }
        const abilityKey = action === "attach"
            ? "update"
            : ((action === "download" || action === "url" || action === "attachmentList") ? "find" : action);
        const abilityAction = abilities[abilityKey];
        if (typeof abilityAction !== "string" || abilityAction.length < 1) {
            throw new Error(`Resource '${frontendModelResource.modelName}' must define abilities.${abilityKey}`);
        }
        return abilityAction;
    }
    /**
     * Runs frontend model ability authorized query.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Authorized query for the action.
     */
    frontendModelAbilityAuthorizedQuery(action) {
        const abilityAction = this.frontendModelAbilityAction(action);
        return this.frontendModelClass().accessibleFor(abilityAction, this.currentAbility());
    }
    /**
     * Runs frontend model authorized query.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Authorized query for the action.
     */
    frontendModelAuthorizedQuery(action) {
        const resource = this.frontendModelResourceInstance();
        if (resource.authorizedQuery !== FrontendModelBaseResource.prototype.authorizedQuery) {
            return resource.authorizedQuery(action);
        }
        return this.frontendModelAbilityAuthorizedQuery(action);
    }
    /**
     * Runs frontend model primary key value.
     * @param {import("./database/record/index.js").default} model - Model instance.
     * @returns {string} - Primary key value as string.
     */
    frontendModelPrimaryKeyValue(model) {
        const columnName = this.frontendModelPrimaryKey();
        const attributeNameMap = model.getModelClass().getColumnNameToAttributeNameMap();
        const attributeName = attributeNameMap[columnName] || columnName;
        const value = model.readAttribute(attributeName);
        return String(value);
    }
    /**
     * Runs frontend model filter authorized models.
     * @param {object} args - Arguments.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} args.action - Frontend action.
     * @param {import("./database/record/index.js").default[]} args.models - Candidate models.
     * @returns {Promise<import("./database/record/index.js").default[]>} - Authorized models.
     */
    async frontendModelFilterAuthorizedModels({ action, models }) {
        if (models.length === 0)
            return models;
        const primaryKey = this.frontendModelPrimaryKey();
        const ids = models.map((model) => this.frontendModelPrimaryKeyValue(model));
        const authorizedQuery = this.frontendModelAuthorizedQuery(action).where({ [primaryKey]: ids });
        const authorizedIdsRaw = await authorizedQuery.pluck(primaryKey);
        const authorizedIds = new Set(authorizedIdsRaw.map((id) => String(id)));
        return models.filter((model) => authorizedIds.has(this.frontendModelPrimaryKeyValue(model)));
    }
    /**
     * Runs run frontend model before action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {Promise<boolean>} - Whether action should continue.
     */
    async runFrontendModelBeforeAction(action) {
        const result = await this.frontendModelResourceInstance().beforeAction(action);
        return result !== false;
    }
    /**
     * Runs frontend model find record.
     * @param {"find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @param {string | number} id - Record id.
     * @returns {Promise<import("./database/record/index.js").default | null>} - Located model record.
     */
    async frontendModelFindRecord(action, id) {
        const model = await this.frontendModelResourceInstance().find(action, id);
        if (!model)
            return null;
        const authorizedModels = await this.frontendModelFilterAuthorizedModels({ action, models: [model] });
        return authorizedModels[0] || null;
    }
    /**
     * Runs frontend model create record.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Create attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [nestedAttributes] - Optional nested-attribute payload for cascading writes.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [attachments] - Optional attachment payloads keyed by attachment name.
     * @returns {Promise<import("./database/record/index.js").default | null>} - Created model when authorized.
     */
    async frontendModelCreateRecord(attributes, nestedAttributes = null, attachments = null) {
        const resource = this.frontendModelResourceInstance();
        const model = await resource.create(attributes, { attachments, nestedAttributes, controller: this });
        const authorizedModels = await this.frontendModelFilterAuthorizedModels({ action: "create", models: [model] });
        if (authorizedModels.length > 0) {
            return authorizedModels[0];
        }
        await resource.handleUnauthorizedCreatedModel(model);
        return null;
    }
    /**
     * Runs frontend model records.
     * @returns {Promise<import("./database/record/index.js").default[]>} - Frontend model records.
     */
    async frontendModelRecords() {
        const models = await this.frontendModelResourceInstance().records();
        return await this.frontendModelFilterAuthorizedModels({ action: "index", models });
    }
    /**
     * Runs frontend model preload.
     * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Frontend preload data.
     */
    frontendModelPreload() {
        return normalizeFrontendModelPreload(this.frontendModelParams().preload);
    }
    /**
     * Runs frontend model select.
     * @returns {Record<string, string[]> | null} - Frontend select data.
     */
    frontendModelSelect() {
        return normalizeFrontendModelSelect(this.frontendModelParams().select, this.frontendModelClass().getModelName());
    }
    /**
     * Runs frontend model selects extra.
     * @returns {Record<string, string[]> | null} - Frontend extra-select data (defaults plus these), keyed by model name.
     */
    frontendModelSelectsExtra() {
        return normalizeFrontendModelSelect(this.frontendModelParams().selectsExtra, this.frontendModelClass().getModelName());
    }
    /**
     * Runs frontend model searches.
     * @returns {FrontendModelSearch[]} - Frontend search filters.
     */
    frontendModelSearches() {
        return normalizeFrontendModelSearches(this.frontendModelParams().searches);
    }
    /**
     * Runs frontend model where.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Frontend where filters.
     */
    frontendModelWhere() {
        return normalizeFrontendModelWhere(this.frontendModelParams().where);
    }
    /**
     * Runs frontend model ransack.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Frontend Ransack filters.
     */
    frontendModelRansack() {
        return normalizeFrontendModelRansack(this.frontendModelParams().ransack);
    }
    /**
     * Runs frontend model joins.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Frontend joins descriptors.
     */
    frontendModelJoins() {
        return normalizeFrontendModelJoins(this.frontendModelParams().joins);
    }
    /**
     * Runs frontend model sort.
     * @returns {FrontendModelSort[]} - Frontend sort definitions.
     */
    frontendModelSort() {
        try {
            return normalizeQuerySort(this.frontendModelParams().sort);
        }
        catch (error) {
            return throwFrontendModelQueryErrorForParserError(error);
        }
    }
    /**
     * Runs frontend model group.
     * @returns {FrontendModelGroup[]} - Frontend group definitions.
     */
    frontendModelGroup() {
        try {
            return normalizeQueryGroup(this.frontendModelParams().group);
        }
        catch (error) {
            return throwFrontendModelQueryErrorForParserError(error);
        }
    }
    /**
     * Runs frontend model pagination.
     * @returns {FrontendModelPagination} - Frontend pagination params.
     */
    frontendModelPagination() {
        const params = this.frontendModelParams();
        return normalizeFrontendModelPagination({
            limit: params.limit,
            offset: params.offset,
            page: params.page,
            perPage: params.perPage
        });
    }
    /**
     * Runs frontend model distinct.
     * @returns {boolean | null} - Frontend distinct flag when provided.
     */
    frontendModelDistinct() {
        return normalizeFrontendModelDistinct(this.frontendModelParams().distinct);
    }
    /**
     * Runs frontend model pluck.
     * @returns {FrontendModelPluck[]} - Frontend pluck definitions.
     */
    frontendModelPluck() {
        try {
            const pluck = normalizeQueryPluck(this.frontendModelParams().pluck);
            this.assertFrontendModelPluckDefinitionsAllowed(pluck);
            return pluck;
        }
        catch (error) {
            return throwFrontendModelQueryErrorForParserError(error);
        }
    }
    /**
     * Runs frontend model count requested.
     * @returns {boolean} - Whether the request asks for an aggregate count.
     */
    frontendModelCountRequested() {
        return this.frontendModelParams().count === true;
    }
    /**
     * Runs frontend model with count.
     * @returns {Array<{attributeName: string, relationshipName: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>}
     *   Frontend withCount entries. Empty array when not requested.
     */
    frontendModelWithCount() {
        const raw = this.frontendModelParams().withCount;
        if (!Array.isArray(raw))
            return [];
        /**
         * Entries.
         * @type {Array<{attributeName: string, relationshipName: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} */
        const entries = [];
        for (const entry of raw) {
            if (!entry || typeof entry !== "object")
                continue;
            if (typeof entry.attributeName !== "string" || entry.attributeName.length === 0)
                continue;
            if (typeof entry.relationshipName !== "string" || entry.relationshipName.length === 0)
                continue;
            entries.push({
                attributeName: entry.attributeName,
                relationshipName: entry.relationshipName,
                where: entry.where && typeof entry.where === "object" ? entry.where : undefined
            });
        }
        return entries;
    }
    /**
     * Resolve an entry from the frontend-model `abilities` payload to
     * its backend model class by looking up the resource by modelName
     * across all configured backend projects. Returns null when no
     * resource matches the user-provided ability entry.
     * @param {string} modelName - Frontend model name from an ability request.
     * @returns {typeof import("./database/record/index.js").default | null} - Backend model class exposed under that frontend name, if present.
     */
    _frontendModelClassForAbilities(modelName) {
        if (typeof modelName !== "string" || modelName.length === 0)
            return null;
        const configuration = this.getConfiguration();
        const backendProjects = configuration.getBackendProjects();
        for (const backendProject of backendProjects) {
            const frontendModels = frontendModelResourcesForBackendProject(backendProject);
            const resourceDefinition = frontendModels[modelName];
            if (!resourceDefinition)
                continue;
            const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition);
            if (!resourceClass) {
                throw new Error(`Frontend model '${modelName}' resource definition must be a FrontendModelBaseResource subclass.`);
            }
            return resourceClass.modelClass();
        }
        return null;
    }
    /**
     * Collect every loaded record whose `getModelName()` matches the
     * requested name, walking across the root-level slice plus any
     * preloaded relationships at any depth. Used to evaluate per-record
     * abilities against nested preloaded children with a single batched
     * query per (modelClass, action) pair.
     * @param {import("./database/record/index.js").default[]} rootModels - Loaded roots whose relationship graphs should be traversed.
     * @param {string} modelName - Model name records must match.
     * @returns {import("./database/record/index.js").default[]} - Matching records reachable from the loaded roots.
     */
    _frontendModelCollectRecordsForName(rootModels, modelName) {
        /**
         * Out.
         * @type {import("./database/record/index.js").default[]} */
        const out = [];
        /**
         * Seen.
         * @type {Set<import("./database/record/index.js").default>} */
        const seen = new Set();
        /**
         * Walk.
         * @param {import("./database/record/index.js").default | null | undefined} record - Loaded record whose relationship graph should be visited.
         */
        const walk = (record) => {
            if (!record || typeof record !== "object")
                return;
            if (seen.has(record))
                return;
            seen.add(record);
            const ModelClass = record.getModelClass();
            if (ModelClass.getModelName() === modelName) {
                out.push(record);
            }
            const relationshipsMap = ModelClass.getRelationshipsMap();
            for (const relationshipName of Object.keys(relationshipsMap)) {
                const relationship = record.getRelationshipByName(relationshipName);
                const loaded = relationship.getLoadedOrUndefined();
                if (loaded === undefined)
                    continue;
                if (Array.isArray(loaded)) {
                    for (const child of loaded)
                        walk(child);
                }
                else {
                    walk(loaded);
                }
            }
        };
        for (const root of rootModels)
            walk(root);
        return out;
    }
    /**
     * Evaluate every ability requested via the frontend `abilities`
     * param against the loaded model cohort (plus any preloaded
     * children), attaching the results to each record via
     * `_setComputedAbility`. Runs one batched `authorized query + pluck`
     * per (modelClass, action) pair, regardless of how many records
     * were loaded.
     * @param {import("./database/record/index.js").default[]} rootModels - Loaded roots that receive computed ability results.
     * @returns {Promise<void>}
     */
    async frontendModelComputeAbilities(rootModels) {
        const entries = this.frontendModelAbilities();
        if (entries.length === 0)
            return;
        if (!Array.isArray(rootModels) || rootModels.length === 0)
            return;
        const ability = this.currentAbility();
        if (!ability)
            return;
        for (const entry of entries) {
            const modelClass = this._frontendModelClassForAbilities(entry.modelName);
            if (!modelClass)
                continue;
            const candidates = this._frontendModelCollectRecordsForName(rootModels, entry.modelName);
            if (candidates.length === 0)
                continue;
            const primaryKey = modelClass.primaryKey();
            const ids = candidates
                .map((record) => record.readAttribute(primaryKey))
                .filter((value) => value !== null && value !== undefined);
            if (ids.length === 0)
                continue;
            for (const action of entry.actions) {
                let allowedIds;
                try {
                    const authorizedQuery = modelClass.accessibleFor(action, ability).where({ [primaryKey]: ids });
                    const plucked = await authorizedQuery.pluck(primaryKey);
                    allowedIds = new Set(plucked.map((value) => String(value)));
                }
                catch (error) {
                    // An ability with no allow rules for the action throws via
                    // `accessibleFor`; treat as a universal deny so the frontend
                    // gets `can(action) === false` for every candidate, instead
                    // of surfacing an error that the UI can't act on.
                    void error;
                    allowedIds = new Set();
                }
                for (const record of candidates) {
                    const idValue = record.readAttribute(primaryKey);
                    const allowed = idValue !== null && idValue !== undefined && allowedIds.has(String(idValue));
                    record._setComputedAbility(action, allowed);
                }
            }
        }
    }
    /**
     * Parse the frontend-model `abilities` param into a list of
     * `{modelName, actions}` entries to evaluate against loaded records.
     * Unknown entries are silently skipped — downstream code resolves
     * model names to classes when applying the check, so unresolved
     * names naturally become no-ops.
     * @returns {Array<{modelName: string, actions: string[]}>} - Normalized model ability requests.
     */
    frontendModelAbilities() {
        const raw = this.frontendModelParams().abilities;
        if (!Array.isArray(raw))
            return [];
        /**
         * Entries.
         * @type {Array<{modelName: string, actions: string[]}>} */
        const entries = [];
        for (const entry of raw) {
            if (!entry || typeof entry !== "object")
                continue;
            if (typeof entry.modelName !== "string" || entry.modelName.length === 0)
                continue;
            if (!Array.isArray(entry.actions))
                continue;
            const actions = entry.actions.filter((/** @type {ReturnType<typeof JSON.parse>} */ action) => typeof action === "string" && action.length > 0);
            if (actions.length === 0)
                continue;
            entries.push({ actions, modelName: entry.modelName });
        }
        return entries;
    }
    /**
     * Read the frontend-model `queryData` param. The wire format carries
     * only **names** (the keys the frontend wants attached) plus the
     * optional nested-relationship chain leading to them — the actual SQL
     * fragments live on the backend model as `Model.queryData(name, fn)`
     * registrations. Callers cannot push SQL through this endpoint.
     *
     * Returns the raw nested-record spec (shape validated by the
     * normalizer inside `Query.queryData`) or `null` when not requested.
     * @returns {import("./database/query/query-data.js").QueryDataSpec | null} - Normalized query-data specification.
     */
    frontendModelQueryData() {
        const raw = this.frontendModelParams().queryData;
        if (raw == null)
            return null;
        if (typeof raw === "string")
            return raw;
        if (Array.isArray(raw))
            return raw;
        if (typeof raw === "object")
            return raw;
        return null;
    }
    /**
     * Runs frontend model index query.
     * @param {FrontendModelIndexQueryOptions} [options] - Index query options.
     * @returns {import("./database/query/model-class-query.js").default} - Frontend index query with normalized params applied.
     */
    frontendModelIndexQuery(options = {}) {
        const { includePagination = true, includeSort = true, resource = this.frontendModelResourceInstance() } = options;
        let query = this.frontendModelAuthorizedQuery("index");
        const preload = this.frontendModelPreload();
        if (preload) {
            query = query.preload(preload);
        }
        const joins = this.frontendModelJoins();
        const where = this.frontendModelWhere();
        const pagination = this.frontendModelPagination();
        const distinct = this.frontendModelDistinct();
        if (includePagination) {
            resource.applyFrontendModelIndexPagination({ controller: this, pagination, query });
        }
        if (distinct !== null) {
            query.distinct(distinct);
        }
        if (where) {
            this.applyFrontendModelWhere({ query, where });
        }
        const ransack = this.frontendModelRansack();
        if (ransack) {
            this.assertFrontendModelRansackAllowed(ransack);
            query.ransack(ransack);
        }
        if (joins) {
            this.applyFrontendModelJoins({ joins, query });
        }
        const searches = this.frontendModelSearches();
        for (const search of searches) {
            resource.applyFrontendModelIndexSearch({ controller: this, query, search });
        }
        const groups = this.frontendModelGroup();
        if (groups.length > 0) {
            this.applyFrontendModelRootGroupColumns({ query });
        }
        for (const group of groups) {
            this.applyFrontendModelGroup({ group, query });
        }
        const sorts = this.frontendModelSort();
        if (includeSort && sorts.length > 0) {
            for (const sort of sorts) {
                resource.applyFrontendModelIndexSort({ controller: this, query, sort });
            }
        }
        const withCount = this.frontendModelWithCount();
        for (const entry of withCount) {
            /**
             * Spec.
             * @type {Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} */
            const spec = {};
            spec[entry.attributeName] = { relationship: entry.relationshipName, where: entry.where };
            query.withCount(spec);
        }
        const queryData = this.frontendModelQueryData();
        if (queryData != null) {
            query.queryData(queryData);
        }
        query = this.applyFrontendModelTranslatedAttributePreloads({ query });
        if (query._distinct && query.driver.getType() === "mssql") {
            return this.frontendModelMssqlDistinctByPrimaryKeyQuery({ query });
        }
        return query;
    }
    /**
     * MSSQL cannot apply DISTINCT over non-comparable text columns in table.* selects.
     * This rewrites distinct frontend-model queries to select root records by distinct PK subquery.
     * @param {object} args - Args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query with distinct and filters.
     * @returns {import("./database/query/model-class-query.js").default} - MSSQL-safe distinct query.
     */
    frontendModelMssqlDistinctByPrimaryKeyQuery({ query }) {
        const modelClass = this.frontendModelClass();
        const primaryKey = modelClass.primaryKey();
        const rootTableSql = query.driver.quoteTable(modelClass.tableName());
        const primaryKeySql = `${rootTableSql}.${query.driver.quoteColumn(primaryKey)}`;
        const distinctIdsQuery = query.clone();
        distinctIdsQuery._preload = {};
        distinctIdsQuery._selects = [];
        distinctIdsQuery.select(primaryKeySql);
        distinctIdsQuery.distinct(true);
        const distinctRootQuery = modelClass._newQuery();
        distinctRootQuery.where(`${primaryKeySql} IN (${distinctIdsQuery.toSql()})`);
        distinctRootQuery._preload = { ...query._preload };
        return distinctRootQuery;
    }
    /**
     * Runs frontend model pluck values.
     * @param {object} args - Pluck args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelPluck[]} args.pluck - Pluck descriptors.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Plucked values.
     */
    async frontendModelPluckValues({ query, pluck }) {
        if (pluck.length < 1) {
            throw new Error("No columns given to pluck");
        }
        const modelClass = this.frontendModelClass();
        const pluckQuery = query.clone();
        /**
         * Aliases.
         * @type {string[]} */
        const aliases = [];
        const queryMetadata = frontendModelQueryMetadata(query);
        const pluckQueryMetadata = frontendModelQueryMetadata(pluckQuery);
        const joinedPaths = queryMetadata[frontendModelJoinedPathsSymbol];
        pluckQuery._preload = {};
        pluckQuery._selects = [];
        pluckQueryMetadata[frontendModelJoinedPathsSymbol] = joinedPaths ? new Set(joinedPaths) : new Set();
        for (const [pluckIndex, pluckEntry] of pluck.entries()) {
            const targetModelClass = this.frontendModelSearchTargetModelClass({
                modelClass,
                path: pluckEntry.path
            });
            const columnName = this.resolveFrontendModelQueryableColumnName({
                attributeName: pluckEntry.column,
                modelClass: targetModelClass,
                operationName: "pluck"
            });
            if (!columnName) {
                throw frontendModelQueryError(`Unknown pluck column "${pluckEntry.column}" for ${targetModelClass.name}`);
            }
            if (pluckEntry.path.length > 0) {
                this.ensureFrontendModelJoinPath({ path: pluckEntry.path, query: pluckQuery });
            }
            const tableReference = pluckQuery.getTableReferenceForJoin(...pluckEntry.path);
            const columnSql = `${pluckQuery.driver.quoteTable(tableReference)}.${pluckQuery.driver.quoteColumn(columnName)}`;
            const alias = `frontend_model_pluck_${pluckIndex}`;
            pluckQuery.select(`${columnSql} AS ${pluckQuery.driver.quoteColumn(alias)}`);
            aliases.push(alias);
        }
        const rows = await pluckQuery.results();
        if (aliases.length === 1) {
            const [alias] = aliases;
            return rows.map((row) => /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row)[alias]);
        }
        return rows.map((row) => {
            const rowHash = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (row);
            return aliases.map((alias) => rowHash[alias]);
        });
    }
    /**
     * Resolves a frontend-model pluck attribute to a database column.
     * @param {{attributeName: string, modelClass: typeof import("./database/record/index.js").default}} args - Arguments.
     * @returns {string | undefined} Resolved DB column name.
     */
    resolveFrontendModelPluckColumnName({ attributeName, modelClass }) {
        const attributeNames = this.frontendModelResourceAttributeNamesForModelClass(modelClass);
        if (attributeNames && !attributeNames.has(attributeName))
            return undefined;
        return this.resolveFrontendModelColumnName(modelClass, attributeName);
    }
    /**
     * Runs exposed frontend-model resource attribute names for a model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {Set<string> | null} Exposed resource attribute names, or null when the resource exposes all DB-backed model attributes.
     */
    frontendModelResourceAttributeNamesForModelClass(modelClass) {
        const frontendModelResource = this.frontendModelResourceConfigurationForModelClass(modelClass);
        if (!frontendModelResource)
            return new Set();
        const attributes = frontendModelResource.resourceConfiguration.attributes;
        if (!attributes)
            return null;
        const attributeNames = this.frontendModelResourceAttributeNames(attributes);
        if (attributeNames.size < 1)
            return null;
        return attributeNames;
    }
    /**
     * Runs exposed frontend-model resource attribute names.
     * @param {import("./configuration-types.js").FrontendModelResourceConfiguration["attributes"]} attributes - Resource attributes.
     * @returns {Set<string>} Exposed resource attribute names.
     */
    frontendModelResourceAttributeNames(attributes) {
        /** @type {Set<string>} */
        const attributeNames = new Set();
        if (Array.isArray(attributes)) {
            for (const attribute of attributes) {
                if (typeof attribute === "string") {
                    attributeNames.add(attribute);
                    continue;
                }
                const attributeConfig = /** @type {import("./configuration-types.js").FrontendModelAttributeConfiguration} */ (attribute);
                if (typeof attributeConfig.name !== "string" || attributeConfig.name.length < 1) {
                    throw new Error("Frontend-model resource attribute array entries must be strings or configs with a name.");
                }
                attributeNames.add(attributeConfig.name);
            }
            return attributeNames;
        }
        return new Set(Object.keys(attributes));
    }
    /**
     * Asserts frontend-model pluck definitions only reference exposed resource attributes.
     * @param {FrontendModelPluck[]} pluck - Pluck descriptors.
     * @returns {void}
     */
    assertFrontendModelPluckDefinitionsAllowed(pluck) {
        const modelClass = this.frontendModelClass();
        for (const pluckEntry of pluck) {
            const targetModelClass = this.frontendModelSearchTargetModelClass({
                modelClass,
                path: pluckEntry.path
            });
            const columnName = this.resolveFrontendModelPluckColumnName({
                attributeName: pluckEntry.column,
                modelClass: targetModelClass
            });
            if (!columnName) {
                throw frontendModelQueryError(`Unknown pluck column "${pluckEntry.column}" for ${targetModelClass.name}`);
            }
        }
    }
    /**
     * Asserts frontend-model Ransack definitions only reference exposed resource attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} ransack - Ransack descriptor.
     * @returns {void}
     */
    assertFrontendModelRansackAllowed(ransack) {
        const { s, ...filterParams } = ransack;
        if (Object.keys(filterParams).length > 0) {
            this.assertFrontendModelRansackGroupAllowed({
                group: this.frontendModelRansackGroup(filterParams)
            });
        }
        if (typeof s === "string" && s.trim().length > 0) {
            for (const sort of this.frontendModelRansackSorts(s)) {
                this.assertFrontendModelRansackAttributeAllowed({
                    attributeName: sort.attribute,
                    modelClass: this.frontendModelClass(),
                    operationName: "ransack sort"
                });
            }
        }
    }
    /**
     * Runs normalized frontend-model Ransack group.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} filterParams - Ransack filter params.
     * @returns {import("./utils/ransack.js").RansackGroup} Normalized Ransack group.
     */
    frontendModelRansackGroup(filterParams) {
        try {
            return normalizeRansackGroup(this.frontendModelClass(), filterParams);
        }
        catch (error) {
            return throwFrontendModelQueryErrorForParserError(error);
        }
    }
    /**
     * Runs normalized frontend-model Ransack sorts.
     * @param {string} sortString - Ransack sort string.
     * @returns {import("./utils/ransack.js").RansackSort[]} Normalized Ransack sorts.
     */
    frontendModelRansackSorts(sortString) {
        try {
            return parseRansackSort(this.frontendModelClass(), sortString);
        }
        catch (error) {
            return throwFrontendModelQueryErrorForParserError(error);
        }
    }
    /**
     * Asserts a normalized frontend-model Ransack group only references exposed attributes.
     * @param {object} args - Assertion args.
     * @param {import("./utils/ransack.js").RansackGroup} args.group - Ransack group.
     * @returns {void}
     */
    assertFrontendModelRansackGroupAllowed({ group }) {
        for (const condition of group.conditions) {
            for (const attribute of condition.attributes) {
                const targetModelClass = this.frontendModelSearchTargetModelClass({
                    modelClass: this.frontendModelClass(),
                    path: attribute.path
                });
                this.assertFrontendModelRansackAttributeAllowed({
                    attributeName: attribute.attributeName,
                    modelClass: targetModelClass,
                    operationName: "ransack"
                });
            }
        }
        for (const grouping of group.groupings) {
            this.assertFrontendModelRansackGroupAllowed({ group: grouping });
        }
    }
    /**
     * Asserts one normalized frontend-model Ransack attribute is exposed by its resource.
     * @param {object} args - Assertion args.
     * @param {string} args.attributeName - Attribute name.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Target model class.
     * @param {string} args.operationName - Operation name for errors.
     * @returns {void}
     */
    assertFrontendModelRansackAttributeAllowed({ attributeName, modelClass, operationName }) {
        const attributeNames = this.frontendModelResourceAttributeNamesForModelClass(modelClass);
        if (attributeNames && !attributeNames.has(attributeName)) {
            throw frontendModelQueryError(`Unknown ${operationName} attribute "${attributeName}" for ${modelClass.name}`);
        }
    }
    /**
     * Runs frontend model search target model class.
     * @param {object} args - Search args.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Root model class.
     * @param {string[]} args.path - Relationship path.
     * @returns {typeof import("./database/record/index.js").default} - Target model class.
     */
    frontendModelSearchTargetModelClass({ modelClass, path }) {
        let targetModelClass = modelClass;
        for (const relationshipName of path) {
            const relationship = targetModelClass.getRelationshipsMap()[relationshipName];
            if (!relationship) {
                throw frontendModelQueryError(`Unknown search relationship "${relationshipName}" for ${targetModelClass.name}`);
            }
            const relationshipTargetModelClass = relationship.getTargetModelClass();
            if (!relationshipTargetModelClass) {
                throw new Error(`No target model class for ${targetModelClass.name}#${relationshipName}`);
            }
            targetModelClass = relationshipTargetModelClass;
        }
        return targetModelClass;
    }
    /**
     * Runs apply frontend model search.
     * @param {object} args - Search args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelSearch} args.search - Search filter.
     * @returns {void}
     */
    applyFrontendModelSearch({ query, search }) {
        const modelClass = this.frontendModelClass();
        const targetModelClass = this.frontendModelSearchTargetModelClass({
            modelClass,
            path: search.path
        });
        const columnName = this.resolveFrontendModelQueryableColumnName({
            attributeName: search.column,
            modelClass: targetModelClass,
            operationName: "search"
        });
        if (!columnName) {
            throw frontendModelQueryError(`Unknown search column "${search.column}" for ${targetModelClass.name}`);
        }
        if (search.path.length > 0) {
            this.ensureFrontendModelJoinPath({ path: search.path, query });
        }
        const tableReference = query.getTableReferenceForJoin(...search.path);
        const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`;
        const operatorMap = {
            eq: "=",
            gt: ">",
            gteq: ">=",
            like: "LIKE",
            lt: "<",
            lteq: "<=",
            notEq: "!="
        };
        const sqlOperator = operatorMap[search.operator];
        if (search.operator === "eq") {
            if (this.applyFrontendModelArraySearch({ emptySql: "1=0", operatorSql: "IN", query, search, columnSql }))
                return;
            if (search.value === null) {
                query.where(`${columnSql} IS NULL`);
                return;
            }
        }
        if (search.operator === "notEq") {
            if (this.applyFrontendModelArraySearch({ emptySql: "1=1", operatorSql: "NOT IN", query, search, columnSql }))
                return;
            if (search.value === null) {
                query.where(`${columnSql} IS NOT NULL`);
                return;
            }
        }
        query.where(`${columnSql} ${sqlOperator} ${query.driver.quote(search.value)}`);
    }
    /**
     * Apply array-valued equality search filters.
     * @param {object} args - Search arguments.
     * @param {string} args.columnSql - SQL for the searched column.
     * @param {string} args.emptySql - SQL predicate used when the array is empty.
     * @param {"IN" | "NOT IN"} args.operatorSql - SQL array operator.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelSearch} args.search - Search descriptor.
     * @returns {boolean} - Whether an array predicate was applied.
     */
    applyFrontendModelArraySearch({ columnSql, emptySql, operatorSql, query, search }) {
        if (!Array.isArray(search.value))
            return false;
        if (search.value.length === 0) {
            query.where(emptySql);
        }
        else {
            query.where(`${columnSql} ${operatorSql} (${search.value.map((entry) => query.driver.quote(entry)).join(", ")})`);
        }
        return true;
    }
    /**
     * Runs apply frontend model pagination.
     * @param {object} args - Pagination args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelPagination} args.pagination - Pagination values.
     * @returns {void}
     */
    applyFrontendModelPagination({ query, pagination }) {
        if (pagination.limit !== null) {
            query.limit(pagination.limit);
        }
        if (pagination.offset !== null) {
            query.offset(pagination.offset);
        }
        if (pagination.perPage !== null) {
            query.perPage(pagination.perPage);
        }
        if (pagination.page !== null) {
            query.page(pagination.page);
        }
    }
    /**
     * Runs apply frontend model where.
     * @param {object} args - Where args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.where - Root-model where conditions.
     * @returns {void}
     */
    applyFrontendModelWhere({ query, where }) {
        this.applyFrontendModelWhereForPath({
            modelClass: this.frontendModelClass(),
            path: [],
            query,
            where
        });
    }
    /**
     * Runs apply frontend model joins.
     * @param {object} args - Joins args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.joins - Relationship-object joins.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelJoins({ joins, query }) {
        const joinPathKeys = new Set();
        this.applyFrontendModelJoinsForPath({
            joins,
            joinPathKeys,
            modelClass: this.frontendModelClass(),
            path: [],
            query
        });
        query.joins(joins);
        const queryMetadata = frontendModelQueryMetadata(query);
        const joinedPaths = queryMetadata[frontendModelJoinedPathsSymbol] || new Set();
        for (const joinPathKey of joinPathKeys) {
            joinedPaths.add(joinPathKey);
        }
        queryMetadata[frontendModelJoinedPathsSymbol] = joinedPaths;
    }
    /**
     * Runs apply frontend model joins for path.
     * @param {object} args - Joins args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.joins - Joins for current path.
     * @param {Set<string>} args.joinPathKeys - Joined path keys.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current path.
     * @param {string[]} args.path - Relationship path.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelJoinsForPath({ joins, joinPathKeys, modelClass, path, query }) {
        void query;
        for (const [relationshipName, relationshipJoin] of Object.entries(joins)) {
            const relationship = modelClass.getRelationshipsMap()[relationshipName];
            if (!relationship) {
                throw frontendModelQueryError(`Unknown join relationship "${relationshipName}" for ${modelClass.name}`);
            }
            const targetModelClass = relationship.getTargetModelClass();
            if (!targetModelClass) {
                throw new Error(`No target model class for join relationship "${relationshipName}" on ${modelClass.name}`);
            }
            const relationshipPath = [...path, relationshipName];
            joinPathKeys.add(relationshipPath.join("."));
            if (relationshipJoin === true)
                continue;
            this.applyFrontendModelJoinsForPath({
                joins: relationshipJoin,
                joinPathKeys,
                modelClass: targetModelClass,
                path: relationshipPath,
                query
            });
        }
    }
    /**
     * Runs frontend model exposed attribute names for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {Set<string> | null} - Exposed attribute names, or null when no resource metadata is available.
     */
    frontendModelExposedAttributeNamesForModelClass(modelClass) {
        const frontendModelResource = this.frontendModelResourceConfigurationForModelClass(modelClass);
        const attributes = frontendModelResource?.resourceConfiguration.attributes;
        if (!attributes)
            return null;
        if (Array.isArray(attributes)) {
            const attributeNames = attributes
                .map((entry) => {
                if (typeof entry === "string")
                    return entry;
                if (!entry || typeof entry !== "object")
                    return null;
                const name = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (entry).name;
                return typeof name === "string" && name.length > 0 ? name : null;
            })
                .filter((entry) => typeof entry === "string");
            if (attributeNames.length === 0)
                return null;
            return new Set(attributeNames);
        }
        if (typeof attributes === "object") {
            return new Set(Object.keys(attributes));
        }
        return null;
    }
    /**
     * Resolves a frontend-supplied key to its canonical model attribute name.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {string} key - Frontend key or raw column key.
     * @returns {string | null} - Canonical attribute name.
     */
    frontendModelAttributeNameForKey(modelClass, key) {
        const resolvedAttributeName = modelClass.resolveAttributeName(key);
        if (resolvedAttributeName)
            return resolvedAttributeName;
        const columnAttributeName = modelClass.getColumnNameToAttributeNameMap()[key];
        return columnAttributeName || null;
    }
    /**
     * Checks if a frontend-supplied attribute is exposed by the resource.
     * @param {object} args - Args.
     * @param {string} args.attributeName - Requested attribute name.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @returns {boolean} - Whether the resource permits the attribute.
     */
    frontendModelAttributeIsExposed({ attributeName, modelClass }) {
        const exposedAttributeNames = this.frontendModelExposedAttributeNamesForModelClass(modelClass);
        if (!exposedAttributeNames)
            return true;
        return exposedAttributeNames.has(attributeName);
    }
    /**
     * Asserts a selected frontend-model attribute list only references exposed attributes.
     * @param {object} args - Args.
     * @param {string[]} args.attributeNames - Selected attribute names.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @param {"select" | "selectsExtra"} args.operationName - Selection operation.
     * @returns {string[]} - Allowed selected attribute names.
     */
    assertFrontendModelSelectedAttributesAllowed({ attributeNames, modelClass, operationName }) {
        for (const attributeName of attributeNames) {
            if (this.frontendModelAttributeIsExposed({ attributeName, modelClass }))
                continue;
            throw frontendModelQueryError(`Unknown ${operationName} attribute "${attributeName}" for ${modelClass.name}`);
        }
        return attributeNames;
    }
    /**
     * Resolves a user-queryable frontend attribute to a database column.
     * @param {object} args - Args.
     * @param {string} args.attributeName - Requested attribute name.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @param {"group" | "pluck" | "search" | "sort" | "where"} args.operationName - Query operation.
     * @returns {string | undefined} - Resolved column name.
     */
    resolveFrontendModelQueryableColumnName({ attributeName, modelClass, operationName }) {
        void operationName;
        const resolvedAttributeName = this.frontendModelAttributeNameForKey(modelClass, attributeName);
        if (resolvedAttributeName && !this.frontendModelAttributeIsExposed({ attributeName: resolvedAttributeName, modelClass })) {
            return undefined;
        }
        return this.resolveFrontendModelColumnName(modelClass, attributeName);
    }
    /**
     * Resolves a key that may be either a camelCase attribute name or a raw DB
     * column name to its canonical column name.  Returns `undefined` when the
     * key matches neither map.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {string} key - Attribute name or column name to resolve.
     * @returns {string | undefined} - Resolved DB column name, or `undefined`.
     */
    resolveFrontendModelColumnName(modelClass, key) {
        const resolvedAttributeName = modelClass.resolveAttributeName(key);
        if (resolvedAttributeName)
            return modelClass.getAttributeNameToColumnNameMap()[resolvedAttributeName];
        // Fall back: the key may already be a raw DB column name not present in the attribute map.
        if (modelClass.getColumnNameToAttributeNameMap()[key])
            return key;
        return undefined;
    }
    /**
     * Runs apply frontend model where for path.
     * @param {object} args - Where args.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current where scope.
     * @param {string[]} args.path - Relationship path from root.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.where - Where conditions for current scope.
     * @returns {void}
     */
    applyFrontendModelWhereForPath({ modelClass, path, query, where }) {
        for (const [attributeName, value] of Object.entries(where)) {
            const columnName = this.resolveFrontendModelQueryableColumnName({
                attributeName,
                modelClass,
                operationName: "where"
            });
            if (columnName) {
                this.ensureFrontendModelJoinPath({ path, query });
                const tableReference = query.getTableReferenceForJoin(...path);
                const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`;
                if (Array.isArray(value)) {
                    if (value.length === 0) {
                        query.where("1=0");
                    }
                    else {
                        const normalizedValues = value.map((entry) => this.normalizeFrontendModelWhereColumnValue({ columnName, modelClass, value: entry }));
                        if (normalizedValues.includes(frontendModelWhereNoMatchSymbol)) {
                            query.where("1=0");
                        }
                        else {
                            query.where(`${columnSql} IN (${normalizedValues.map((entry) => query.driver.quote(entry)).join(", ")})`);
                        }
                    }
                    continue;
                }
                if (value == null) {
                    query.where(`${columnSql} IS NULL`);
                }
                else {
                    const normalizedValue = this.normalizeFrontendModelWhereColumnValue({ columnName, modelClass, value });
                    if (normalizedValue === frontendModelWhereNoMatchSymbol) {
                        query.where("1=0");
                    }
                    else {
                        query.where(`${columnSql} = ${query.driver.quote(normalizedValue)}`);
                    }
                }
                continue;
            }
            if (isPlainObject(value)) {
                const relationship = modelClass.getRelationshipsMap()[attributeName];
                if (!relationship) {
                    throw frontendModelQueryError(`Unknown where relationship "${attributeName}" for ${modelClass.name}`);
                }
                const targetModelClass = relationship.getTargetModelClass();
                if (!targetModelClass) {
                    throw new Error(`No target model class for where relationship "${attributeName}" on ${modelClass.name}`);
                }
                const relationshipPath = [...path, attributeName];
                this.applyFrontendModelWhereForPath({
                    modelClass: targetModelClass,
                    path: relationshipPath,
                    query,
                    where: value
                });
                continue;
            }
            throw frontendModelQueryError(`Unknown where column "${attributeName}" for ${modelClass.name}`);
        }
    }
    /**
     * Runs normalize frontend model where column value.
     * @param {object} args - Args.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Where value.
     * @returns {ReturnType<typeof JSON.parse> | symbol} - SQL-safe where value.
     */
    normalizeFrontendModelWhereColumnValue({ columnName, modelClass, value }) {
        if (typeof value === "string") {
            const columnType = modelClass.getColumnTypeByName(columnName)?.toLowerCase();
            const isDateTimeColumn = typeof columnType === "string" && ["date", "datetime", "timestamp"].some((type) => columnType.includes(type));
            if (isDateTimeColumn) {
                const parsedDate = normalizeDateStringForWrite(value, { timeZone: this.getConfiguration().getEnvironmentHandler().getTimeZone(this.getConfiguration()) });
                if (isDate(parsedDate)) {
                    return parsedDate;
                }
            }
        }
        if (isPlainObject(value)) {
            const columnType = modelClass.getColumnTypeByName(columnName);
            if (typeof columnType !== "string") {
                return frontendModelWhereNoMatchSymbol;
            }
            const normalizedType = columnType.toLowerCase();
            const objectValueTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"]);
            const supportsObjectValues = normalizedType.includes("text") || objectValueTypes.has(normalizedType);
            if (!supportsObjectValues) {
                return frontendModelWhereNoMatchSymbol;
            }
            return JSON.stringify(value);
        }
        return value;
    }
    /**
     * Runs apply frontend model group.
     * @param {object} args - Group args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelGroup} args.group - Group definition.
     * @returns {void}
     */
    applyFrontendModelGroup({ query, group }) {
        const modelClass = this.frontendModelClass();
        const targetModelClass = this.frontendModelSearchTargetModelClass({
            modelClass,
            path: group.path
        });
        const columnName = this.resolveFrontendModelQueryableColumnName({
            attributeName: group.column,
            modelClass: targetModelClass,
            operationName: "group"
        });
        if (!columnName) {
            throw frontendModelQueryError(`Unknown group column "${group.column}" for ${targetModelClass.name}`);
        }
        this.ensureFrontendModelJoinPath({ path: group.path, query });
        const tableReference = query.getTableReferenceForJoin(...group.path);
        const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`;
        this.ensureFrontendModelGroupColumn({ columnSql, query });
    }
    /**
     * Adds root-model columns to GROUP BY so strict SQL engines accept default root-table selects.
     * @param {object} args - Args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelRootGroupColumns({ query }) {
        const modelClass = this.frontendModelClass();
        const attributeNameToColumnNameMap = modelClass.getAttributeNameToColumnNameMap();
        const rootTableReference = query.getTableReferenceForJoin();
        for (const columnName of Object.values(attributeNameToColumnNameMap)) {
            const columnSql = `${query.driver.quoteTable(rootTableReference)}.${query.driver.quoteColumn(columnName)}`;
            this.ensureFrontendModelGroupColumn({ columnSql, query });
        }
    }
    /**
     * Ensures a group-by SQL column is only appended once.
     * @param {object} args - Args.
     * @param {string} args.columnSql - Fully-qualified column SQL.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    ensureFrontendModelGroupColumn({ columnSql, query }) {
        const queryMetadata = frontendModelQueryMetadata(query);
        const groupedColumns = queryMetadata[frontendModelGroupedColumnsSymbol] || new Set();
        if (groupedColumns.has(columnSql))
            return;
        query.group(columnSql);
        groupedColumns.add(columnSql);
        queryMetadata[frontendModelGroupedColumnsSymbol] = groupedColumns;
    }
    /**
     * Runs apply frontend model translated attribute preloads.
     * @param {object} args - Args.
     * @param {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} args.query - Query instance.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Query with translations preloaded if needed.
     */
    applyFrontendModelTranslatedAttributePreloads({ query }) {
        const modelClass = this.frontendModelClass();
        const selectedAttributes = this.frontendModelEffectiveSelectedAttributesForModelClass(modelClass, this.frontendModelDefaultAttributesForModelClass(modelClass) || [])
            || this.frontendModelDefaultAttributesForModelClass(modelClass);
        if (!selectedAttributes)
            return query;
        const resource = this.frontendModelResourceInstance();
        const resourceClass = /** @type {typeof import("./frontend-model-resource/base-resource.js").default} */ (resource.constructor);
        const translatedSet = new Set(resourceClass.translatedAttributesConfig() || []);
        let needsTranslations = false;
        for (const attributeName of selectedAttributes) {
            const hookName = `${attributeName}AttributeSelected`;
            const dynamicResource = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(resource));
            if (typeof dynamicResource[hookName] === "function") {
                const result = dynamicResource[hookName]({ query });
                if (result) {
                    query = result;
                }
            }
            else if (translatedSet.has(attributeName)) {
                needsTranslations = true;
            }
        }
        if (needsTranslations) {
            query = query.preload({ translations: {} });
        }
        return query;
    }
    /**
     * Runs apply frontend model sort.
     * @param {object} args - Sort args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelSort} args.sort - Sort definition.
     * @returns {void}
     */
    applyFrontendModelSort({ query, sort }) {
        const modelClass = this.frontendModelClass();
        const targetModelClass = this.frontendModelSearchTargetModelClass({
            modelClass,
            path: sort.path
        });
        const translatedAttributesMap = targetModelClass.getTranslationsMap();
        const translatedAttributeNames = Object.keys(translatedAttributesMap);
        const isTranslatedSortAttribute = translatedAttributeNames.includes(sort.column);
        const columnName = this.resolveFrontendModelQueryableColumnName({
            attributeName: sort.column,
            modelClass: targetModelClass,
            operationName: "sort"
        });
        const direction = sort.direction.toUpperCase();
        if (isTranslatedSortAttribute) {
            const translationModelClass = targetModelClass.getTranslationClass();
            const translationAttributeNameToColumnNameMap = translationModelClass.getAttributeNameToColumnNameMap();
            const translationColumnName = translationAttributeNameToColumnNameMap[sort.column];
            const translationPath = sort.path.concat(["currentTranslation"]);
            if (!translationColumnName) {
                throw frontendModelQueryError(`Unknown translated sort column "${sort.column}" for ${targetModelClass.name}`);
            }
            this.ensureFrontendModelSortJoinPath({ path: translationPath, query });
            const translationTableReference = query.getTableReferenceForJoin(...translationPath);
            const translationColumnSql = `${query.driver.quoteTable(translationTableReference)}.${query.driver.quoteColumn(translationColumnName)}`;
            query.order(`${translationColumnSql} ${direction}`);
            return;
        }
        if (!columnName) {
            throw frontendModelQueryError(`Unknown sort column "${sort.column}" for ${targetModelClass.name}`);
        }
        this.ensureFrontendModelSortJoinPath({ path: sort.path, query });
        const tableReference = query.getTableReferenceForJoin(...sort.path);
        const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`;
        query.order(`${columnSql} ${direction}`);
    }
    /**
     * Ensures a sort join path has been joined on query.
     * @param {object} args - Join args.
     * @param {string[]} args.path - Relationship join path.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    ensureFrontendModelSortJoinPath({ path, query }) {
        this.ensureFrontendModelJoinPath({ path, query });
    }
    /**
     * Ensures a relationship path has exactly one SQL join.
     * @param {object} args - Join args.
     * @param {string[]} args.path - Relationship join path.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    ensureFrontendModelJoinPath({ path, query }) {
        if (path.length < 1)
            return;
        const queryMetadata = frontendModelQueryMetadata(query);
        const joinedPaths = queryMetadata[frontendModelJoinedPathsSymbol] || new Set();
        const pathKey = path.join(".");
        if (joinedPaths.has(pathKey))
            return;
        query.joins(buildFrontendModelJoinObjectFromPath(path));
        joinedPaths.add(pathKey);
        queryMetadata[frontendModelJoinedPathsSymbol] = joinedPaths;
    }
    /**
     * Runs frontend model selected attributes for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {string[] | null} - Selected attributes for model class.
     */
    frontendModelSelectedAttributesForModelClass(modelClass) {
        const select = this.frontendModelSelect();
        if (!select)
            return null;
        const selectedAttributes = select[modelClass.getModelName()] || null;
        if (!selectedAttributes)
            return null;
        return this.assertFrontendModelSelectedAttributesAllowed({
            attributeNames: selectedAttributes,
            modelClass,
            operationName: "select"
        });
    }
    /**
     * Runs frontend model selects extra for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {string[] | null} - Extra attributes (loaded in addition to the defaults) for the model class.
     */
    frontendModelSelectsExtraForModelClass(modelClass) {
        const selectsExtra = this.frontendModelSelectsExtra();
        if (!selectsExtra)
            return null;
        const extraAttributes = selectsExtra[modelClass.getModelName()] || null;
        if (!extraAttributes)
            return null;
        return this.assertFrontendModelSelectedAttributesAllowed({
            attributeNames: extraAttributes,
            modelClass,
            operationName: "selectsExtra"
        });
    }
    /**
     * Resolves the final set of attribute names to serialize for a model class:
     * an explicit narrowing `select` wins; otherwise, when `selectsExtra` is given,
     * the default attributes plus the extras; otherwise null (default behavior).
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {string[]} fallbackAttributeNames - Attribute names to treat as the defaults when the resource declares none.
     * @returns {string[] | null} - Effective selected attribute names, or null for default serialization.
     */
    frontendModelEffectiveSelectedAttributesForModelClass(modelClass, fallbackAttributeNames) {
        const selectedAttributes = this.frontendModelSelectedAttributesForModelClass(modelClass);
        if (selectedAttributes)
            return selectedAttributes;
        const extraAttributes = this.frontendModelSelectsExtraForModelClass(modelClass);
        if (!extraAttributes)
            return null;
        const defaultAttributes = this.frontendModelDefaultAttributesForModelClass(modelClass) || fallbackAttributeNames;
        return Array.from(new Set([...defaultAttributes, ...extraAttributes]));
    }
    /**
     * Runs frontend model default attributes for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {string[] | null} - Default frontend-model attributes declared on the resource.
     */
    frontendModelDefaultAttributesForModelClass(modelClass) {
        const frontendModelResource = this.frontendModelResourceConfigurationForModelClass(modelClass);
        const attributes = frontendModelResource?.resourceConfiguration.attributes;
        if (!attributes)
            return null;
        if (Array.isArray(attributes)) {
            return attributes
                .filter((entry) => {
                if (typeof entry === "string")
                    return true;
                const config = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (entry);
                if (config && config.selectedByDefault === false)
                    return false;
                return true;
            })
                .map((entry) => typeof entry === "string" ? entry : /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (entry).name);
        }
        if (typeof attributes === "object") {
            return Object.entries(attributes)
                .filter(([, config]) => {
                if (!config || typeof config !== "object")
                    return true;
                return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (config).selectedByDefault !== false;
            })
                .map(([name]) => name);
        }
        return null;
    }
    /**
     * Runs serialize frontend model attributes.
     * @param {import("./database/record/index.js").default} model - Model instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized attributes filtered by select map.
     */
    async serializeFrontendModelAttributes(model) {
        const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor);
        const modelAttributes = model.attributes();
        const selectedAttributes = this.frontendModelEffectiveSelectedAttributesForModelClass(modelClass, Object.keys(modelAttributes));
        const defaultAttributes = this.frontendModelDefaultAttributesForModelClass(modelClass);
        const resourceInstance = this._serializationResourceInstanceForModel(model);
        /**
         * Resource attribute method name.
         * @param {string} attributeName - Attribute name.
         * @returns {string} - Resource attribute method name.
         */
        const resourceAttributeMethodName = (attributeName) => `${attributeName}Attribute`;
        /**
         * Resource has attribute.
         * @param {string} attributeName - Attribute name.
         * @returns {ReturnType<FrontendModelBaseResource["resourceMethod"]>} - Resource attribute method details.
         */
        const resourceAttributeMethod = (attributeName) => {
            const methodName = resourceAttributeMethodName(attributeName);
            return resourceInstance?.resourceMethod(methodName) || null;
        };
        /**
         * Prototype attribute method.
         * @param {string} attributeName - Attribute name.
         * @returns {{method: (...args: Array<ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>, ownerName: string} | undefined} - Prototype method details when present.
         */
        const prototypeAttributeMethod = (attributeName) => {
            let currentPrototype = Object.getPrototypeOf(model);
            while (currentPrototype && currentPrototype !== Object.prototype) {
                const candidate = Object.getOwnPropertyDescriptor(currentPrototype, attributeName)?.value;
                if (typeof candidate === "function") {
                    return {
                        method: candidate,
                        ownerName: currentPrototype.constructor?.name
                    };
                }
                currentPrototype = Object.getPrototypeOf(currentPrototype);
            }
        };
        /**
         * Serialized attribute value.
         * @param {string} attributeName - Attribute name.
         * @returns {Promise<ReturnType<typeof JSON.parse>>} - Serialized attribute value.
         */
        const serializedAttributeValue = async (attributeName) => {
            // Check resource instance first (virtual/computed attributes via ${name}Attribute convention)
            const resourceAttribute = resourceAttributeMethod(attributeName);
            if (resourceAttribute) {
                return await resourceAttribute.method.call(resourceAttribute.resource, model);
            }
            // Fall back to model method
            const attributeMethodLookup = prototypeAttributeMethod(attributeName);
            const attributeMethod = attributeMethodLookup?.method;
            if (typeof attributeMethod === "function") {
                return await attributeMethod.call(model);
            }
            return modelAttributes[attributeName];
        };
        /**
         * Attribute exists.
         * @param {string} attributeName - Attribute name.
         * @returns {boolean} - Whether the attribute exists.
         */
        const attributeExists = (attributeName) => {
            return (attributeName in modelAttributes) || (attributeName in /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (model)) || Boolean(resourceAttributeMethod(attributeName));
        };
        if (!selectedAttributes) {
            if (!defaultAttributes || defaultAttributes.length < 1) {
                return modelAttributes;
            }
            /**
             * Serialized attributes.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const serializedAttributes = {};
            for (const attributeName of defaultAttributes) {
                if (!attributeExists(attributeName))
                    continue;
                serializedAttributes[attributeName] = await serializedAttributeValue(attributeName);
            }
            return serializedAttributes;
        }
        /**
         * Serialized attributes.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const serializedAttributes = {};
        for (const attributeName of selectedAttributes) {
            if (!attributeExists(attributeName))
                continue;
            serializedAttributes[attributeName] = await serializedAttributeValue(attributeName);
        }
        return serializedAttributes;
    }
    /**
     * Returns the request-scoped serialization resource instance cache.
     * @returns {Map<typeof import("./database/record/index.js").default, Map<boolean, import("./frontend-model-resource/base-resource.js").default>>} - Cache.
     */
    _frontendModelSerializationResourceInstancesMap() {
        if (!this._frontendModelSerializationResourceInstances) {
            this._frontendModelSerializationResourceInstances = new Map();
        }
        return this._frontendModelSerializationResourceInstances;
    }
    /**
     * Looks up a cached serialization resource instance.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {boolean} isRelated - Whether the resource is for a related (non-root) model.
     * @returns {import("./frontend-model-resource/base-resource.js").default | undefined} - Cached resource or undefined.
     */
    _cachedSerializationResourceInstance(modelClass, isRelated) {
        return this._frontendModelSerializationResourceInstancesMap().get(modelClass)?.get(isRelated);
    }
    /**
     * Stores a serialization resource instance in the request-scoped cache.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {boolean} isRelated - Whether the resource is for a related (non-root) model.
     * @param {import("./frontend-model-resource/base-resource.js").default} resource - Resource instance.
     * @returns {void}
     */
    _setCachedSerializationResourceInstance(modelClass, isRelated, resource) {
        const byClass = this._frontendModelSerializationResourceInstancesMap();
        let byRelated = byClass.get(modelClass);
        if (!byRelated) {
            byRelated = new Map();
            byClass.set(modelClass, byRelated);
        }
        byRelated.set(isRelated, resource);
    }
    /**
     * Sets a per-instance hook invoked for every serialization resource instance
     * resolution. The hook is scoped to this controller; it never affects other
     * controller instances. Passing `null` clears the hook.
     * @param {FrontendModelSerializationResourceInstanceHook | null} hook - Hook callback or null.
     * @returns {() => void} - Cleanup function that restores the previous hook.
     */
    setSerializationResourceInstanceHook(hook) {
        const previousHook = this._frontendModelSerializationResourceInstanceHook;
        this._frontendModelSerializationResourceInstanceHook = hook;
        return () => {
            this._frontendModelSerializationResourceInstanceHook = previousHook;
        };
    }
    /**
     * Runs serialization resource instance for model.
     * @param {import("./database/record/index.js").default} model - Model instance.
     * @returns {import("./frontend-model-resource/base-resource.js").default | null} - Resource instance or null.
     */
    _serializationResourceInstanceForModel(model) {
        const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor);
        const isRelated = modelClass !== this.frontendModelClass();
        const cachedResource = this._cachedSerializationResourceInstance(modelClass, isRelated);
        if (cachedResource) {
            if (this._frontendModelSerializationResourceInstanceHook) {
                this._frontendModelSerializationResourceInstanceHook(model, cachedResource);
            }
            return cachedResource;
        }
        /** @type {import("./frontend-model-resource/base-resource.js").default | null} */
        let resource;
        if (!isRelated) {
            resource = this.frontendModelResourceInstance();
            this._setCachedSerializationResourceInstance(modelClass, false, resource);
        }
        else {
            const configuration = this.getConfiguration();
            const backendProjects = configuration.getBackendProjects();
            const modelClassName = modelClass.getModelName();
            resource = null;
            for (const backendProject of backendProjects) {
                const resources = frontendModelResourcesWithBuiltInsForBackendProject(backendProject);
                const resourceDefinition = resources[modelClassName];
                const resourceClass = resourceDefinition ? frontendModelResourceClassFromDefinition(resourceDefinition) : null;
                if (resourceClass) {
                    resource = new resourceClass({
                        ability: this.currentAbility(),
                        // Propagate the controller so a related/preloaded model's serialization
                        // resource can use request context (e.g. `requestBaseUrl()` for signed
                        // download URLs). Without it, any `<attr>Attribute` method that reaches
                        // for the controller throws "requires a controller instance." when a
                        // relationship is serialized as a preload.
                        controller: this,
                        context: this.currentAbility()?.getContext() || {},
                        locals: this.currentAbility()?.getLocals() || {},
                        modelClass,
                        modelName: modelClassName,
                        params: {},
                        resourceConfiguration: resourceClass.resourceConfig()
                    });
                    this._setCachedSerializationResourceInstance(modelClass, true, resource);
                    break;
                }
            }
        }
        if (this._frontendModelSerializationResourceInstanceHook) {
            this._frontendModelSerializationResourceInstanceHook(model, resource);
        }
        return resource;
    }
    /**
     * Runs frontend model filter serializable related models.
     * @param {object} args - Arguments.
     * @param {import("./database/record/index.js").default[]} args.models - Frontend model records.
     * @param {boolean} args.relationshipIsCollection - Whether relation is has-many.
     * @returns {Promise<import("./database/record/index.js").default[]>} - Serializable related models.
     */
    async frontendModelFilterSerializableRelatedModels({ models, relationshipIsCollection }) {
        if (!this.currentAbility())
            return models;
        if (models.length === 0)
            return models;
        /**
         * Models by class.
         * @type {Map<typeof import("./database/record/index.js").default, import("./database/record/index.js").default[]>} */
        const modelsByClass = new Map();
        for (const model of models) {
            const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor);
            const existingModelsForClass = modelsByClass.get(relatedModelClass) || [];
            existingModelsForClass.push(model);
            modelsByClass.set(relatedModelClass, existingModelsForClass);
        }
        /**
         * Authorized ids by class.
         * @type {Map<typeof import("./database/record/index.js").default, Set<string>>} */
        const authorizedIdsByClass = new Map();
        /**
         * Primary keys by class.
         * @type {Map<typeof import("./database/record/index.js").default, string>} */
        const primaryKeysByClass = new Map();
        for (const [relatedModelClass, relatedModels] of modelsByClass.entries()) {
            const relatedResource = this.frontendModelResourceConfigurationForModelClass(relatedModelClass);
            if (!relatedResource) {
                authorizedIdsByClass.set(relatedModelClass, new Set());
                continue;
            }
            const abilityAction = relationshipIsCollection
                ? relatedResource.resourceConfiguration.abilities?.index
                : relatedResource.resourceConfiguration.abilities?.find;
            if (typeof abilityAction !== "string" || abilityAction.length < 1) {
                authorizedIdsByClass.set(relatedModelClass, new Set());
                continue;
            }
            const primaryKey = relatedModelClass.primaryKey();
            const ids = relatedModels
                .map((model) => model.attributes()[primaryKey])
                .filter((id) => id !== undefined && id !== null);
            if (ids.length < 1) {
                authorizedIdsByClass.set(relatedModelClass, new Set());
                continue;
            }
            const authorizedIdsRaw = await relatedModelClass
                .accessibleFor(abilityAction)
                .where({ [primaryKey]: ids })
                .pluck(primaryKey);
            primaryKeysByClass.set(relatedModelClass, primaryKey);
            authorizedIdsByClass.set(relatedModelClass, new Set(authorizedIdsRaw.map((id) => String(id))));
        }
        return models.filter((model) => {
            const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor);
            const authorizedIds = authorizedIdsByClass.get(relatedModelClass);
            const primaryKey = primaryKeysByClass.get(relatedModelClass);
            if (!authorizedIds || !primaryKey)
                return false;
            const primaryKeyValue = model.attributes()[primaryKey];
            if (primaryKeyValue === undefined || primaryKeyValue === null)
                return false;
            return authorizedIds.has(String(primaryKeyValue));
        });
    }
    /**
     * Runs is serializable frontend model.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate preloaded value.
     * @returns {value is import("./database/record/index.js").default} - Whether value behaves like a model.
     */
    isSerializableFrontendModel(value) {
        return Boolean(value && typeof value === "object" && typeof /** @type {ReturnType<typeof JSON.parse>} */ (value).attributes === "function");
    }
    /**
     * Runs serialize frontend models.
     * @param {import("./database/record/index.js").default[]} models - Models to serialize.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Serialized model payloads.
     */
    async serializeFrontendModels(models) {
        if (models.length < 1)
            return [];
        /**
         * Preloaded relationships per model.
         * @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const preloadedRelationshipsPerModel = Array.from({ length: models.length }, () => ({}));
        /**
         * Collection relationship entries.
         * @type {Array<{loadedModels: import("./database/record/index.js").default[], modelIndex: number, relationshipName: string}>} */
        const collectionRelationshipEntries = [];
        /**
         * Singular relationship entries.
         * @type {Array<{loadedModel: import("./database/record/index.js").default, modelIndex: number, relationshipName: string}>} */
        const singularRelationshipEntries = [];
        models.forEach((model, modelIndex) => {
            const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor);
            const relationshipsMap = modelClass.getRelationshipsMap();
            const resource = this._serializationResourceInstanceForModel(model);
            const resourceConfiguration = resource ? resource.resourceConfiguration() : null;
            const exposedRelationships = new Set(resourceConfiguration && Array.isArray(resourceConfiguration.relationships)
                ? resourceConfiguration.relationships
                : []);
            for (const relationshipName in relationshipsMap) {
                if (!exposedRelationships.has(relationshipName))
                    continue;
                const relationship = model.getRelationshipByName(relationshipName);
                if (!relationship.getPreloaded())
                    continue;
                const loadedRelationship = relationship.loaded();
                if (Array.isArray(loadedRelationship)) {
                    collectionRelationshipEntries.push({ loadedModels: loadedRelationship, modelIndex, relationshipName });
                    continue;
                }
                if (this.isSerializableFrontendModel(loadedRelationship)) {
                    singularRelationshipEntries.push({ loadedModel: loadedRelationship, modelIndex, relationshipName });
                    continue;
                }
                preloadedRelationshipsPerModel[modelIndex][relationshipName] = loadedRelationship == undefined ? null : loadedRelationship;
            }
        });
        if (collectionRelationshipEntries.length > 0) {
            const allCollectionModels = collectionRelationshipEntries.flatMap((entry) => entry.loadedModels);
            const serializableCollectionModels = await this.frontendModelFilterSerializableRelatedModels({
                models: allCollectionModels,
                relationshipIsCollection: true
            });
            const serializableCollectionModelsSet = new Set(serializableCollectionModels);
            for (const relationshipEntry of collectionRelationshipEntries) {
                const allowedModels = relationshipEntry.loadedModels.filter((relatedModel) => serializableCollectionModelsSet.has(relatedModel));
                const serializedRelatedModels = await this.serializeFrontendModels(allowedModels);
                preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = serializedRelatedModels;
            }
        }
        if (singularRelationshipEntries.length > 0) {
            const allSingularModels = singularRelationshipEntries.map((entry) => entry.loadedModel);
            const serializableSingularModels = await this.frontendModelFilterSerializableRelatedModels({
                models: allSingularModels,
                relationshipIsCollection: false
            });
            const serializableSingularModelsSet = new Set(serializableSingularModels);
            for (const relationshipEntry of singularRelationshipEntries) {
                if (!serializableSingularModelsSet.has(relationshipEntry.loadedModel)) {
                    preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = null;
                    continue;
                }
                const serializedModel = (await this.serializeFrontendModels([relationshipEntry.loadedModel]))[0];
                preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = serializedModel;
            }
        }
        /**
         * Serialized models.
         * @type {Record<string, ReturnType<typeof JSON.parse>>[]} */
        const serializedModels = [];
        for (const [modelIndex, model] of models.entries()) {
            const serializedAttributes = await this.serializeFrontendModelAttributes(model);
            const preloadedRelationships = preloadedRelationshipsPerModel[modelIndex];
            const associationCounts = model.associationCounts();
            const queryDataValues = model.queryDataValues();
            const computedAbilities = model.computedAbilities();
            const hasCounts = Object.keys(associationCounts).length > 0;
            const hasQueryData = Object.keys(queryDataValues).length > 0;
            const hasAbilities = Object.keys(computedAbilities).length > 0;
            const hasPreloaded = Object.keys(preloadedRelationships).length > 0;
            if (!hasPreloaded && !hasCounts && !hasQueryData && !hasAbilities) {
                serializedModels.push(serializedAttributes);
                continue;
            }
            /**
             * Serialized.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const serialized = { ...serializedAttributes };
            if (hasPreloaded)
                serialized.__preloadedRelationships = preloadedRelationships;
            if (hasCounts)
                serialized.__associationCounts = associationCounts;
            if (hasQueryData)
                serialized.__queryData = queryDataValues;
            if (hasAbilities)
                serialized.__abilities = computedAbilities;
            serializedModels.push(serialized);
        }
        return serializedModels;
    }
    /**
     * Runs serialize frontend model.
     * @param {import("./database/record/index.js").default} model - Frontend model record.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized frontend model payload.
     */
    async serializeFrontendModel(model) {
        const serializedModels = await this.serializeFrontendModels([model]);
        return serializedModels[0];
    }
    /**
     * Runs frontend model render error.
     * @param {string} errorMessage - Error message.
     * @returns {Promise<void>} - Resolves when error has been rendered.
     */
    async frontendModelRenderError(errorMessage) {
        await this.logger.error(`Frontend model request failed: ${errorMessage}`);
        const renderError = /** @type {((errorMessage: string) => Promise<void>) | undefined} */ (
        /** @type {ReturnType<typeof JSON.parse>} */ (this).renderError);
        if (typeof renderError === "function") {
            await renderError.call(this, frontendModelClientSafeErrorMessage);
            return;
        }
        await this.render({
            json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue({
                errorMessage: frontendModelClientSafeErrorMessage,
                status: "error"
            }, this.transportSerializationOptions()))
        });
    }
    /**
     * Runs frontend model error payload.
     * @param {string} errorMessage - Error message.
     * @param {object} [options] - Structured error fields.
     * @param {import("./configuration-types.js").ClientErrorPayloadReporterPayload} [options.details] - Client-safe details.
     * @param {"application_error" | "authorization_error" | "internal_error" | "record_not_found" | "validation_error"} [options.errorType] - Stable client-facing error category.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Error payload.
     */
    frontendModelErrorPayload(errorMessage, options = {}) {
        return {
            ...(options.details ? { details: options.details } : {}),
            errorMessage,
            ...(options.errorType ? { errorType: options.errorType } : {}),
            status: "error"
        };
    }
    /**
     * Runs frontend model client safe error payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client-safe error payload.
     */
    frontendModelClientSafeErrorPayload() {
        return this.frontendModelErrorPayload(frontendModelClientSafeErrorMessage);
    }
    /**
     * Builds frontend-model endpoint error context for logging and client payload reporters.
     * @param {object} args - Error context args.
     * @param {string} args.action - Endpoint/action label.
     * @param {unknown} args.error - Caught error.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url" | "custom-command"} [args.commandType] - Frontend-model command type.
     * @param {string | undefined} [args.model] - Request model name when available.
     * @param {string | undefined} [args.requestId] - Batch request id when available.
     * @returns {FrontendModelEndpointErrorContext} Frontend-model endpoint error context.
     */
    frontendModelEndpointErrorContext({ action, commandType, error, model, requestId }) {
        let resolvedModel = model;
        const expectedError = frontendModelExpectedError(error);
        if (!resolvedModel) {
            const cachedParams = this._frontendModelParamsOverride || this._frontendModelParams;
            const paramsModel = cachedParams ? cachedParams.model : undefined;
            resolvedModel = typeof paramsModel === "string" && paramsModel.length > 0 ? paramsModel : undefined;
        }
        return {
            action,
            commandType,
            controller: this.constructor.name,
            ...(expectedError ? {} : { correlationId: randomUUID() }),
            expectedError,
            frontendModelEndpoint: true,
            model: resolvedModel,
            requestId
        };
    }
    /**
     * Runs frontend model client error payload for error.
     * @param {unknown} error - Caught error.
     * @param {FrontendModelEndpointErrorContext | undefined} [endpointErrorContext] - Frontend-model endpoint error context.
     * @returns {Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>} - Client payload for the current environment.
     */
    async frontendModelClientErrorPayloadForError(error, endpointErrorContext) {
        const velociousMetadata = frontendModelVelociousMetadataForError(error);
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        /** @type {import("./configuration-types.js").ClientErrorPayloadReporterPayload} */
        const safeErrorPayload = {};
        if (error instanceof VelociousError && error.safeToExpose) {
            if (error.errorType)
                safeErrorPayload.errorType = error.errorType;
            if (error.details)
                safeErrorPayload.details = error.details;
        }
        else if (error instanceof RecordNotFoundError) {
            safeErrorPayload.errorType = "record_not_found";
        }
        else if (velociousMetadata) {
            if (typeof velociousMetadata.errorType === "string") {
                safeErrorPayload.errorType = velociousMetadata.errorType;
            }
            if (isPlainObject(velociousMetadata.details)) {
                safeErrorPayload.details = velociousMetadata.details;
            }
        }
        let validationErrorsPayload = {};
        if (error instanceof ValidationError) {
            const validationErrors = error.getValidationErrors();
            const model = error.getModel();
            /**
             * Structured errors.
             * @type {Record<string, {type: string, message: string, fullMessage: string}[]>} */
            const structuredErrors = {};
            for (const attributeName in validationErrors) {
                structuredErrors[attributeName] = validationErrors[attributeName].map(err => ({
                    type: err.type,
                    message: err.message,
                    fullMessage: `${model.getModelClass().humanAttributeName(attributeName)} ${err.message}`
                }));
            }
            validationErrorsPayload = {
                errorType: "validation_error",
                validationErrors: structuredErrors
            };
        }
        const reporterPayload = await this.getConfiguration().clientErrorPayloadForError({
            context: endpointErrorContext || { controller: this.constructor.name },
            error: normalizedError,
            request: this.getRequest()
        });
        if (!this.getConfiguration().getExposeInternalErrorsToClients()) {
            delete reporterPayload.debugBacktrace;
            delete reporterPayload.debugErrorClass;
            delete reporterPayload.debugErrorMessage;
        }
        return {
            ...reporterPayload,
            ...this.frontendModelErrorPayload(frontendModelClientMessageForError(error, this.getConfiguration().getExposeInternalErrorsToClients())),
            ...frontendModelDebugPayloadForError({
                configuration: this.getConfiguration(),
                error
            }),
            ...(velociousMetadata ? { velocious: velociousMetadata } : {}),
            ...safeErrorPayload,
            ...validationErrorsPayload,
            ...(!endpointErrorContext?.expectedError && endpointErrorContext?.correlationId
                ? { correlationId: endpointErrorContext.correlationId, errorType: "internal_error" }
                : {})
        };
    }
    /**
     * Runs frontend model log endpoint error.
     * @param {object} args - Error log args.
     * @param {ReturnType<typeof JSON.parse>} args.error - Caught error.
     * @param {FrontendModelEndpointErrorContext} args.errorContext - Shared client/logging error context.
     * @returns {Promise<void>} - Resolves after logging.
     */
    async frontendModelLogEndpointError({ error, errorContext }) {
        // Expected user-flow errors are surfaced to clients by
        // frontendModelClientErrorPayloadForError, but skipped here so monitoring
        // stays focused on real backend failures.
        if (errorContext.expectedError)
            return;
        const configuration = this.getConfiguration();
        const redactor = configuration.getLogRedactor();
        const requestTiming = configuration.getCurrentRequestTiming();
        const sensitiveValues = requestTiming ? requestTiming.getLogSensitiveValues() : new Set();
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const redactedError = redactor.redactError(normalizedError, sensitiveValues);
        const redactedContext = /** @type {FrontendModelEndpointErrorContext} */ (redactor.redactStructured(errorContext, sensitiveValues));
        await this.logger.error(() => ["Frontend model endpoint request failed", {
                action: redactedContext.action,
                commandType: redactedContext.commandType,
                correlationId: redactedContext.correlationId,
                errorBacktrace: redactedError.stack,
                errorClass: redactedError.name,
                errorMessage: redactedError.message,
                model: redactedContext.model,
                requestId: redactedContext.requestId
            }]);
        // Surface genuinely unexpected backend failures on the framework-error
        // channel so process-level bug reporters capture them, instead of the
        // controller silently swallowing them behind the generic "Request
        // failed." client message.
        const errorPayload = {
            correlationId: redactedContext.correlationId,
            context: redactedContext,
            error: redactedError,
            request: this.getRequest(),
            requestDetails: requestDetails(this.getRequest(), { redactor, sensitiveValues })
        };
        this.getConfiguration().getErrorEvents().emit("framework-error", errorPayload);
        this.getConfiguration().getErrorEvents().emit("all-error", { ...errorPayload, errorType: "framework-error" });
    }
    /**
     * Runs frontend model render command response.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {Promise<void>} - Resolves when response has been rendered.
     */
    async frontendModelRenderCommandResponse(action) {
        try {
            const responsePayload = await this.frontendModelCommandPayload(action);
            if (!responsePayload)
                return;
            await this.render({
                json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(responsePayload, this.transportSerializationOptions()))
            });
        }
        catch (error) {
            const errorContext = this.frontendModelEndpointErrorContext({ action, commandType: action, error });
            await this.frontendModelLogEndpointError({ error, errorContext });
            await this.render({
                json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(await this.frontendModelClientErrorPayloadForError(error, errorContext), this.transportSerializationOptions()))
            });
        }
    }
    /**
     * Runs frontend model command payload.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Response payload.
     */
    async frontendModelCommandPayload(action) {
        await this.ensureFrontendModelClassInitialized();
        if (!(await this.runFrontendModelBeforeAction(action))) {
            return null;
        }
        const resource = this.frontendModelResourceInstance();
        if (action === "index") {
            if (this.frontendModelCountRequested()) {
                if (!(await resource.supportsCount("index"))) {
                    throw new Error("count is not supported when resource records are customized");
                }
                return {
                    count: await resource.count(),
                    status: "success"
                };
            }
            const pluck = this.frontendModelPluck();
            if (pluck.length > 0) {
                if (!(await resource.supportsPluck("index"))) {
                    throw new Error("pluck is not supported when resource records are customized");
                }
                const values = await this.frontendModelPluckValues({
                    pluck,
                    query: resource.indexQuery()
                });
                return {
                    status: "success",
                    values
                };
            }
            const models = await this.frontendModelRecords();
            await this.frontendModelComputeAbilities(models);
            const serializedModels = await Promise.all(models.map(async (model) => await resource.serialize(model, "index")));
            return {
                models: serializedModels,
                status: "success"
            };
        }
        const params = this.frontendModelParams();
        const modelClass = this.frontendModelClass();
        const id = params.id;
        if (action === "create") {
            const mutationAttributes = frontendModelMutationAttributes(params);
            if (typeof mutationAttributes === "string")
                return this.frontendModelErrorPayload(mutationAttributes);
            const model = await this.frontendModelCreateRecord(mutationAttributes.attributes, mutationAttributes.nestedAttributes, mutationAttributes.attachments);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            const serializedModel = await resource.serialize(model, "create");
            return frontendModelSerializedModelSuccess(serializedModel);
        }
        if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
            return this.frontendModelErrorPayload("Expected model id.", { errorType: "validation_error" });
        }
        if (action === "attach") {
            const attachmentName = params.attachmentName;
            const attachmentInput = params.attachment;
            if (typeof attachmentName !== "string" || attachmentName.length < 1) {
                return this.frontendModelErrorPayload("Expected attachmentName.");
            }
            if (typeof attachmentInput === "undefined") {
                return this.frontendModelErrorPayload("Expected attachment input.");
            }
            const model = await this.frontendModelFindRecord("attach", id);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            await model.getAttachmentByName(attachmentName).attach(attachmentInput);
            const serializedModel = await this.serializeFrontendModel(model);
            return frontendModelSerializedModelSuccess(serializedModel);
        }
        if (action === "download") {
            const attachmentParams = frontendModelAttachmentParams(params);
            if (typeof attachmentParams === "string")
                return this.frontendModelErrorPayload(attachmentParams);
            const model = await this.frontendModelFindRecord("download", id);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            const downloadedAttachment = await model.getAttachmentByName(attachmentParams.attachmentName).download(attachmentParams.attachmentId);
            if (!downloadedAttachment) {
                return this.frontendModelErrorPayload("Attachment not found.", { errorType: "record_not_found" });
            }
            return {
                attachment: {
                    byteSize: downloadedAttachment.byteSize(),
                    contentBase64: downloadedAttachment.content().toString("base64"),
                    contentType: downloadedAttachment.contentType(),
                    filename: downloadedAttachment.filename(),
                    id: downloadedAttachment.id(),
                    url: downloadedAttachment.url()
                },
                status: "success"
            };
        }
        if (action === "url") {
            const attachmentParams = frontendModelAttachmentParams(params);
            if (typeof attachmentParams === "string")
                return this.frontendModelErrorPayload(attachmentParams);
            const model = await this.frontendModelFindRecord("url", id);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            const url = await model.getAttachmentByName(attachmentParams.attachmentName).url(attachmentParams.attachmentId);
            if (!url) {
                return this.frontendModelErrorPayload("Attachment URL not available.");
            }
            return {
                status: "success",
                url
            };
        }
        if (action === "attachmentList") {
            const attachmentParams = frontendModelAttachmentParams(params);
            if (typeof attachmentParams === "string")
                return this.frontendModelErrorPayload(attachmentParams);
            const model = await this.frontendModelFindRecord("attachmentList", id);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            const attachments = await model.getAttachmentByName(attachmentParams.attachmentName).listMetadata();
            return {
                attachments,
                status: "success"
            };
        }
        if (action === "find") {
            const model = await this.frontendModelFindRecord("find", id);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            await this.frontendModelComputeAbilities([model]);
            const serializedModel = await resource.serialize(model, "find");
            return frontendModelSerializedModelSuccess(serializedModel);
        }
        if (action === "update") {
            const mutationAttributes = frontendModelMutationAttributes(params);
            if (typeof mutationAttributes === "string")
                return this.frontendModelErrorPayload(mutationAttributes);
            const model = await this.frontendModelFindRecord("update", id);
            if (!model) {
                return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
            }
            const updatedModel = await resource.update(model, mutationAttributes.attributes, {
                attachments: mutationAttributes.attachments,
                controller: this,
                nestedAttributes: mutationAttributes.nestedAttributes
            });
            const serializedModel = await resource.serialize(updatedModel, "update");
            return frontendModelSerializedModelSuccess(serializedModel);
        }
        const model = await this.frontendModelFindRecord("destroy", id);
        if (!model) {
            return this.frontendModelErrorPayload(`${modelClass.name} not found.`, { errorType: "record_not_found" });
        }
        await resource.destroy(model);
        return { status: "success" };
    }
    /**
     * Runs frontend sync bootstrap.
     * @returns {Promise<void>} - Sync bootstrap response with manifest and signed offline grant.
     */
    async frontendSyncBootstrap() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        const params = /** @type {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} */ (deserializeFrontendModelTransportValue(this.params()));
        const configuration = this.getConfiguration();
        const syncManifest = frontendModelSyncManifestForBackendProjects(configuration.getBackendProjects());
        const offlineGrant = await createOfflineGrantFromBootstrap({
            deviceId: this.frontendSyncBootstrapDeviceId(params),
            grantId: this.frontendSyncBootstrapGrantId(params),
            grantTtlMs: configuration.getSyncConfiguration().offlineGrantTtlMs,
            now: this.frontendSyncBootstrapNow(params),
            resources: syncManifest,
            scopes: this.frontendSyncBootstrapScopes(params),
            signingKey: configuration.currentOfflineGrantSigningKey(),
            userId: this.frontendSyncBootstrapUserId()
        });
        await this.render({
            json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue({
                offlineGrant,
                status: "success",
                syncManifest
            }, this.transportSerializationOptions()))
        });
    }
    /**
     * Resolves device id for sync bootstrap.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {string} - Device id.
     */
    frontendSyncBootstrapDeviceId(params) {
        if (typeof params.deviceId === "string" && params.deviceId.length > 0)
            return params.deviceId;
        throw new Error("Expected sync bootstrap deviceId");
    }
    /**
     * Resolves grant id for sync bootstrap.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {string | undefined} - Deterministic grant id for tests, generated id otherwise.
     */
    frontendSyncBootstrapGrantId(params) {
        if (this.getConfiguration().getEnvironment() === "test" && typeof params.grantId === "string")
            return params.grantId;
        return undefined;
    }
    /**
     * Resolves bootstrap issue time.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {Date} - Issue time.
     */
    frontendSyncBootstrapNow(params) {
        if (this.getConfiguration().getEnvironment() === "test" && typeof params.now === "string")
            return new Date(params.now);
        return new Date();
    }
    /**
     * Resolves sync bootstrap scopes.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue>} - Grant scopes.
     */
    frontendSyncBootstrapScopes(params) {
        const scopes = params.scopes;
        if (scopes && typeof scopes === "object" && !Array.isArray(scopes)) {
            return /** @type {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue>} */ (scopes);
        }
        return {};
    }
    /**
     * Resolves current user id for sync bootstrap.
     * @returns {string} - User id.
     */
    frontendSyncBootstrapUserId() {
        const ability = this.currentAbility();
        const currentUser = ability?.currentUser();
        if (typeof currentUser === "string" || typeof currentUser === "number")
            return String(currentUser);
        if (currentUser && typeof currentUser === "object") {
            const userRecord = /** @type {{id?: string | number | (() => string | number)}} */ (currentUser);
            const idValue = typeof userRecord.id === "function" ? userRecord.id() : userRecord.id;
            if (typeof idValue === "string" || typeof idValue === "number")
                return String(idValue);
        }
        throw new Error("Expected sync bootstrap current user");
    }
    /**
     * Runs frontend sync replay.
     * @returns {Promise<void>} - Sync replay response with per-mutation results.
     */
    async frontendSyncReplay() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        const params = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(this.params()));
        const signedMutations = this.frontendSyncReplaySignedMutations(params);
        const results = [];
        for (const signedMutation of signedMutations) {
            let idempotencyKey = null;
            try {
                idempotencyKey = mutationIdempotencyKey(/** @type {import("./sync/device-identity.js").SignedSyncMutation} */ (signedMutation));
                const { response, serverChangeFeedError, serverChangeFeedStatus, serverSequence } = await this.frontendSyncReplaySignedMutation(signedMutation);
                results.push({
                    idempotencyKey,
                    response,
                    serverChangeFeedError,
                    serverChangeFeedStatus,
                    serverSequence,
                    status: "success"
                });
            }
            catch (error) {
                const errorContext = this.frontendModelEndpointErrorContext({
                    action: "frontendSyncReplay",
                    commandType: signedMutation && typeof signedMutation === "object" && "mutation" in signedMutation
                        ? /** @type {{mutation?: {operation?: ReturnType<typeof JSON.parse>}}} */ (signedMutation).mutation?.operation
                        : undefined,
                    error,
                    model: signedMutation && typeof signedMutation === "object" && "mutation" in signedMutation
                        ? /** @type {{mutation?: {model?: ReturnType<typeof JSON.parse>}}} */ (signedMutation).mutation?.model
                        : undefined
                });
                await this.frontendModelLogEndpointError({ error, errorContext });
                results.push({
                    idempotencyKey,
                    response: await this.frontendModelClientErrorPayloadForError(error, errorContext),
                    status: "error"
                });
            }
        }
        await this.render({
            json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue({
                results,
                status: "success"
            }, this.transportSerializationOptions()))
        });
    }
    /**
     * Resolves signed replay mutations from request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - Signed mutation envelopes.
     */
    frontendSyncReplaySignedMutations(params) {
        if (Array.isArray(params.mutations))
            return params.mutations;
        if (params.mutation)
            return [params.mutation];
        throw new Error("Expected sync replay mutation or mutations");
    }
    /**
     * Verifies and replays one signed sync mutation.
     * @param {ReturnType<typeof JSON.parse>} signedMutation - Signed mutation envelope.
     * @returns {Promise<{response: Record<string, ReturnType<typeof JSON.parse>>, serverChangeFeedError?: Record<string, ReturnType<typeof JSON.parse>>, serverChangeFeedStatus?: "error", serverSequence: number | null}>} - Frontend-model command response and appended server sequence.
     */
    async frontendSyncReplaySignedMutation(signedMutation) {
        const configuration = this.getConfiguration();
        const syncConfiguration = configuration.getSyncConfiguration();
        const backendPublicKey = syncConfiguration.deviceCertificateBackendPublicKey;
        if (!backendPublicKey)
            throw frontendSyncReplaySafeError("sync.deviceCertificateBackendPublicKey is required for sync replay");
        let mutation;
        try {
            mutation = await verifySignedMutation({
                backendPublicKey,
                signedMutation: /** @type {import("./sync/device-identity.js").SignedSyncMutation} */ (signedMutation)
            });
        }
        catch (error) {
            throw frontendSyncReplaySafeError(error instanceof Error ? error.message : String(error), error);
        }
        const syncManifest = frontendModelSyncManifestForBackendProjects(configuration.getBackendProjects());
        const syncResource = syncManifest[mutation.model];
        if (!syncResource)
            throw frontendSyncReplaySafeError(`Sync replay model is not enabled: ${mutation.model}`);
        if (!syncResource.operations.includes(mutation.operation)) {
            throw frontendSyncReplaySafeError(`Sync replay operation is not enabled for ${mutation.model}: ${mutation.operation}`);
        }
        if (syncResource.policyHash !== mutation.policyHash) {
            throw frontendSyncReplaySafeError(`Sync replay policy hash mismatch for ${mutation.model}`);
        }
        const signedOfflineGrant = this.frontendSyncReplaySignedOfflineGrant(signedMutation);
        const offlineGrant = await this.frontendSyncReplayVerifiedOfflineGrant({
            signedOfflineGrant,
            signingKeys: syncConfiguration.offlineGrantSigningKeys
        });
        this.frontendSyncReplayValidateOfflineGrant({ mutation, offlineGrant, syncResource });
        const commandParams = await this.frontendSyncReplayCommandParams(mutation);
        const replayCommand = this.frontendSyncReplayCommandForMutation(mutation);
        let response;
        try {
            response = await this.withFrontendModelParams(commandParams, async () => {
                return await this.withFrontendModelRequestContext(commandParams, this.response(), async () => {
                    if (["create", "update", "destroy"].includes(mutation.operation)) {
                        return await this.frontendModelCommandPayload(/** @type {"create" | "update" | "destroy"} */ (mutation.operation)) || this.frontendModelErrorPayload("Action halted by beforeAction.");
                    }
                    return await this.frontendSyncReplayCustomCommandPayload({ mutation, replayCommand }) || this.frontendModelErrorPayload("Action halted by beforeAction.");
                });
            });
        }
        catch (error) {
            const errorContext = this.frontendModelEndpointErrorContext({
                action: "frontendSyncReplay",
                commandType: /** @type {ReturnType<typeof JSON.parse>} */ (replayCommand.commandType),
                error,
                model: mutation.model
            });
            await this.frontendModelLogEndpointError({ error, errorContext });
            return {
                response: await this.frontendModelClientErrorPayloadForError(error, errorContext),
                serverSequence: null
            };
        }
        try {
            const serverSequence = await this.frontendSyncAppendServerChange({
                idempotencyKey: mutationIdempotencyKey(/** @type {import("./sync/device-identity.js").SignedSyncMutation} */ (signedMutation)),
                mutation,
                offlineGrant,
                response
            });
            return { response, serverSequence };
        }
        catch (error) {
            const errorContext = this.frontendModelEndpointErrorContext({
                action: "frontendSyncReplay",
                commandType: /** @type {ReturnType<typeof JSON.parse>} */ (replayCommand.commandType),
                error,
                model: mutation.model
            });
            await this.frontendModelLogEndpointError({ error, errorContext });
            return {
                response,
                serverChangeFeedError: await this.frontendModelClientErrorPayloadForError(error, errorContext),
                serverChangeFeedStatus: "error",
                serverSequence: null
            };
        }
    }
    /**
     * Resolves the signed offline grant carried by a replay request.
     * @param {ReturnType<typeof JSON.parse>} signedMutation - Signed mutation envelope.
     * @returns {ReturnType<typeof JSON.parse>} - Signed offline grant envelope.
     */
    frontendSyncReplaySignedOfflineGrant(signedMutation) {
        if (!signedMutation || typeof signedMutation !== "object" || Array.isArray(signedMutation)) {
            throw frontendSyncReplaySafeError("Expected sync replay signed offline grant");
        }
        const signedMutationRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (signedMutation);
        const signedOfflineGrant = signedMutationRecord.signedOfflineGrant || signedMutationRecord.offlineGrant || signedMutationRecord.signedGrant;
        if (!signedOfflineGrant)
            throw frontendSyncReplaySafeError("Expected sync replay signed offline grant");
        return signedOfflineGrant;
    }
    /**
     * Verifies a sync replay signed offline grant.
     * @param {object} args - Arguments.
     * @param {ReturnType<typeof JSON.parse>} args.signedOfflineGrant - Signed offline grant envelope.
     * @param {import("./sync/offline-grant.js").OfflineGrantSigningKey[]} args.signingKeys - Available signing keys.
     * @returns {Promise<import("./sync/offline-grant.js").OfflineGrant>} - Verified offline grant.
     */
    async frontendSyncReplayVerifiedOfflineGrant({ signedOfflineGrant, signingKeys }) {
        try {
            return await verifyOfflineGrant({
                now: new Date(),
                signedGrant: /** @type {import("./sync/offline-grant.js").SignedOfflineGrant} */ (signedOfflineGrant),
                signingKeys
            });
        }
        catch (error) {
            throw frontendSyncReplaySafeError(error instanceof Error ? error.message : String(error), error);
        }
    }
    /**
     * Validates that a verified offline grant authorizes a replayed mutation.
     * @param {object} args - Arguments.
     * @param {import("./sync/device-identity.js").SyncMutation} args.mutation - Verified mutation.
     * @param {import("./sync/offline-grant.js").OfflineGrant} args.offlineGrant - Verified grant.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.syncResource - Current sync resource entry.
     * @returns {void} - Throws when unauthorized.
     */
    frontendSyncReplayValidateOfflineGrant({ mutation, offlineGrant, syncResource }) {
        if (offlineGrant.grantId !== mutation.offlineGrantId) {
            throw frontendSyncReplaySafeError("Sync replay offline grant does not match mutation");
        }
        if (offlineGrant.deviceId !== mutation.actorDeviceId) {
            throw frontendSyncReplaySafeError("Sync replay offline grant device does not match mutation");
        }
        if (offlineGrant.userId !== mutation.actorUserId) {
            throw frontendSyncReplaySafeError("Sync replay offline grant user does not match mutation");
        }
        const grantResource = /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ (offlineGrant.resources[mutation.model]);
        const grantOperations = Array.isArray(grantResource?.operations) ? grantResource.operations : [];
        const grantPolicyHash = grantResource?.policyHash;
        if (!grantResource || grantResource.enabled !== true)
            throw frontendSyncReplaySafeError(`Sync replay offline grant does not authorize ${mutation.model}`);
        if (!grantOperations.includes(mutation.operation)) {
            throw frontendSyncReplaySafeError(`Sync replay offline grant does not authorize ${mutation.model}: ${mutation.operation}`);
        }
        if (grantPolicyHash !== mutation.policyHash || grantPolicyHash !== syncResource.policyHash) {
            throw frontendSyncReplaySafeError(`Sync replay offline grant policy hash mismatch for ${mutation.model}`);
        }
        if (!offlineGrant.scopes || typeof offlineGrant.scopes !== "object" || Array.isArray(offlineGrant.scopes)) {
            throw frontendSyncReplaySafeError("Sync replay offline grant scopes are invalid");
        }
    }
    /**
     * Replays a verified custom sync mutation through the resource command API.
     * @param {object} args - Arguments.
     * @param {import("./sync/device-identity.js").SyncMutation} args.mutation - Verified mutation.
     * @param {{commandType: string, methodName?: string, scope?: "collection" | "member"}} args.replayCommand - Resolved replay command metadata.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Command response payload.
     */
    async frontendSyncReplayCustomCommandPayload({ mutation, replayCommand }) {
        if (typeof replayCommand.methodName !== "string" || replayCommand.methodName.length < 1) {
            throw frontendSyncReplaySafeError(`Sync replay command is not registered for ${mutation.model}: ${mutation.operation}`);
        }
        const frontendModelResource = this.getConfiguration().getBackendProjects()
            .map((backendProject) => this.frontendModelResourceConfigurationForBackendProjectModelName({ backendProject, modelName: mutation.model }))
            .find((resourceConfiguration) => resourceConfiguration);
        if (!frontendModelResource)
            throw frontendSyncReplaySafeError(`Sync replay model is not enabled: ${mutation.model}`);
        const resource = new frontendModelResource.resourceClass({
            ability: this.currentAbility(),
            controller: this,
            context: {
                ...(this.currentAbility()?.getContext() || {}),
                params: this.frontendModelParams(),
                request: this.request()
            },
            locals: this.currentAbility()?.getLocals() || {},
            modelClass: this.frontendModelResourceModelClass(frontendModelResource),
            modelName: frontendModelResource.modelName,
            params: this.frontendModelParams(),
            resourceConfiguration: frontendModelResource.resourceConfiguration
        });
        const command = resource.resourceMethod(replayCommand.methodName);
        if (!command) {
            return this.frontendModelErrorPayload(`Missing frontend-model custom command '${replayCommand.methodName}'.`);
        }
        const commandArguments = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (mutation.payload && typeof mutation.payload === "object" && !Array.isArray(mutation.payload) ? mutation.payload : {});
        const responsePayload = await command.method.call(command.resource, commandArguments);
        if (!responsePayload || typeof responsePayload !== "object") {
            return { status: "success" };
        }
        return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (await this.autoSerializeFrontendModelsInPayload(responsePayload, 
        /** @type {{serialize: (model: ReturnType<typeof JSON.parse>, action: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>>}} */ (command.resource), replayCommand.methodName));
    }
    /**
     * Builds frontend-model command params for a verified replay mutation.
     * @param {import("./sync/device-identity.js").SyncMutation} mutation - Verified mutation.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Frontend-model command params.
     */
    async frontendSyncReplayCommandParams(mutation) {
        const payload = mutation.payload && typeof mutation.payload === "object" && !Array.isArray(mutation.payload) ? mutation.payload : {};
        const { attributes, primaryKeyValue } = await this.frontendSyncReplayCommandAttributes(mutation);
        const commandParams = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({
            ...payload,
            attributes,
            model: mutation.model
        });
        if (["create", "update", "destroy"].includes(mutation.operation)) {
            if (mutation.operation !== "create") {
                const id = commandParams.id || commandParams.recordId || primaryKeyValue;
                if (typeof id !== "string" && typeof id !== "number")
                    throw frontendSyncReplaySafeError(`Sync replay ${mutation.operation} requires an id`);
                commandParams.id = id;
            }
            return commandParams;
        }
        const replayCommand = this.frontendSyncReplayCommandForMutation(mutation);
        commandParams.frontendModelCustomCommandMethodName = replayCommand.methodName;
        commandParams.frontendModelCustomCommandScope = replayCommand.scope;
        if (replayCommand.scope === "member") {
            const id = commandParams.id || commandParams.recordId || primaryKeyValue;
            if (typeof id !== "string" && typeof id !== "number")
                throw frontendSyncReplaySafeError(`Sync replay ${mutation.operation} requires an id`);
            commandParams.id = id;
        }
        return commandParams;
    }
    /**
     * Resolves the frontend-model command used for a verified replay mutation.
     * @param {import("./sync/device-identity.js").SyncMutation} mutation - Verified mutation.
     * @returns {{commandType: string, methodName?: string, scope?: "collection" | "member"}} - Command metadata.
     */
    frontendSyncReplayCommandForMutation(mutation) {
        if (["create", "update", "destroy"].includes(mutation.operation)) {
            return { commandType: mutation.operation };
        }
        const frontendModelResource = this.getConfiguration().getBackendProjects()
            .map((backendProject) => this.frontendModelResourceConfigurationForBackendProjectModelName({ backendProject, modelName: mutation.model }))
            .find((resourceConfiguration) => resourceConfiguration);
        if (!frontendModelResource)
            throw frontendSyncReplaySafeError(`Sync replay model is not enabled: ${mutation.model}`);
        const commandName = typeof mutation.command === "string" && mutation.command.length > 0 ? mutation.command : mutation.operation;
        const resourceConfiguration = frontendModelResource.resourceConfiguration;
        if (Object.prototype.hasOwnProperty.call(resourceConfiguration.collectionCommands, commandName)) {
            return { commandType: commandName, methodName: commandName, scope: "collection" };
        }
        if (Object.prototype.hasOwnProperty.call(resourceConfiguration.memberCommands, commandName)) {
            return { commandType: commandName, methodName: commandName, scope: "member" };
        }
        throw frontendSyncReplaySafeError(`Sync replay command is not registered for ${mutation.model}: ${commandName}`);
    }
    /**
     * Resolves command attributes and primary key from a replay mutation.
     * @param {import("./sync/device-identity.js").SyncMutation} mutation - Verified mutation.
     * @returns {Promise<{attributes: Record<string, ReturnType<typeof JSON.parse>>, primaryKeyValue: string | number | undefined}>} - Command attributes and primary key value.
     */
    async frontendSyncReplayCommandAttributes(mutation) {
        const attributes = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({ ...(mutation.attributes || {}) });
        const frontendModelResource = this.getConfiguration().getBackendProjects()
            .map((backendProject) => this.frontendModelResourceConfigurationForBackendProjectModelName({ backendProject, modelName: mutation.model }))
            .find((resourceConfiguration) => resourceConfiguration);
        if (!frontendModelResource)
            return { attributes, primaryKeyValue: undefined };
        const primaryKey = typeof frontendModelResource.resourceConfiguration.primaryKey === "string" ? frontendModelResource.resourceConfiguration.primaryKey : "id";
        const primaryKeyAttribute = attributes[primaryKey];
        const primaryKeyValue = typeof primaryKeyAttribute === "string" || typeof primaryKeyAttribute === "number" ? primaryKeyAttribute : undefined;
        if (primaryKeyValue !== undefined && mutation.operation !== "create")
            delete attributes[primaryKey];
        return { attributes, primaryKeyValue };
    }
    /**
     * Appends a successfully replayed mutation to the server change feed.
     * @param {object} args - Arguments.
     * @param {string | null} args.idempotencyKey - Mutation idempotency key.
     * @param {import("./sync/device-identity.js").SyncMutation} args.mutation - Verified mutation.
     * @param {import("./sync/offline-grant.js").OfflineGrant} args.offlineGrant - Verified offline grant.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.response - Replay command response.
     * @returns {Promise<number | null>} - Assigned server sequence, or null when no change was appended.
     */
    async frontendSyncAppendServerChange({ idempotencyKey, mutation, offlineGrant, response }) {
        if (response.status !== "success")
            return null;
        const store = serverChangeFeedStoreForConfiguration(this.getConfiguration());
        const responseSyncChanges = Array.isArray(response.syncChanges) ? response.syncChanges : [];
        const syncChanges = responseSyncChanges.length > 0 ? responseSyncChanges : [{
                attributes: mutation.attributes,
                model: mutation.model,
                operation: mutation.operation,
                payload: mutation.payload
            }];
        let serverSequence = /** @type {number | null} */ (null);
        for (const syncChange of syncChanges) {
            if (!syncChange || typeof syncChange !== "object" || Array.isArray(syncChange))
                continue;
            const change = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (syncChange);
            const payload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (change.payload && typeof change.payload === "object" && !Array.isArray(change.payload) ? change.payload : {});
            const attributes = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (change.attributes && typeof change.attributes === "object" && !Array.isArray(change.attributes) ? change.attributes : {});
            const model = typeof change.model === "string" && change.model.length > 0 ? change.model : mutation.model;
            const operation = typeof change.operation === "string" && change.operation.length > 0 ? change.operation : mutation.operation;
            const rawRecordId = change.recordId ?? payload.id ?? payload.recordId ?? attributes.id ?? null;
            const recordId = rawRecordId === null || rawRecordId === undefined ? null : String(rawRecordId);
            const appendedChange = await store.append({
                actorDeviceId: mutation.actorDeviceId,
                actorUserId: mutation.actorUserId,
                attributes,
                idempotencyKey,
                model,
                operation,
                payload,
                recordId,
                response,
                scope: offlineGrant.scopes
            });
            serverSequence = appendedChange.serverSequence;
        }
        return serverSequence;
    }
    /**
     * Verifies the signed offline grant used to scope sync read endpoints.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {Promise<import("./sync/offline-grant.js").OfflineGrant>} - Verified offline grant.
     */
    async frontendSyncRequestVerifiedOfflineGrant(params) {
        const signedOfflineGrant = this.frontendSyncReplaySignedOfflineGrant(params);
        return await this.frontendSyncReplayVerifiedOfflineGrant({
            signedOfflineGrant,
            signingKeys: this.getConfiguration().getSyncConfiguration().offlineGrantSigningKeys
        });
    }
    /**
     * Runs frontend sync change feed.
     * @returns {Promise<void>} - Sync change-feed response.
     */
    async frontendSyncChangeFeed() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        const params = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(this.params()));
        const offlineGrant = await this.frontendSyncRequestVerifiedOfflineGrant(params);
        const afterSequence = this.frontendSyncChangeFeedAfterSequence(params);
        const store = serverChangeFeedStoreForConfiguration(this.getConfiguration());
        const limit = this.frontendSyncChangeFeedLimit(params);
        const currentServerSequence = await store.latestSequence();
        const serverSequence = this.frontendSyncChangeFeedUpToSequence(params, currentServerSequence);
        const page = await store.changesAfter({ afterSequence, limit, scope: offlineGrant.scopes, upToSequence: serverSequence });
        if (page.snapshotRequired) {
            await this.render({
                json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue({
                    changes: [],
                    oldestSequence: page.oldestSequence,
                    requestedAfterSequence: afterSequence,
                    serverSequence,
                    snapshot: await this.frontendSyncSnapshotPayload({ scope: offlineGrant.scopes, serverSequence }),
                    status: "snapshot_required"
                }, this.transportSerializationOptions()))
            });
            return;
        }
        const changes = page.changes;
        const includeSnapshot = params.snapshot === true || params.includeSnapshot === true || afterSequence === 0;
        const snapshot = includeSnapshot ? await this.frontendSyncSnapshotPayload({ scope: offlineGrant.scopes, serverSequence }) : undefined;
        const payload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({
            changes,
            hasMore: page.hasMore,
            nextSequence: page.nextSequence,
            serverSequence,
            status: "success",
            upToSequence: page.upToSequence
        });
        if (snapshot)
            payload.snapshot = snapshot;
        await this.render({
            json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(payload, this.transportSerializationOptions()))
        });
    }
    /**
     * Resolves sync change-feed cursor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {number} - Exclusive lower-bound sequence.
     */
    frontendSyncChangeFeedAfterSequence(params) {
        const afterSequence = params.afterSequence ?? params.cursor ?? 0;
        if (typeof afterSequence === "number" && Number.isInteger(afterSequence) && afterSequence >= 0)
            return afterSequence;
        if (typeof afterSequence === "string" && /^\d+$/.test(afterSequence))
            return Number(afterSequence);
        throw new Error("Expected sync change-feed afterSequence");
    }
    /**
     * Resolves sync change-feed page limit.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {number} - Page limit.
     */
    frontendSyncChangeFeedLimit(params) {
        const limit = params.limit ?? params.pageSize ?? 100;
        if (typeof limit === "number" && Number.isInteger(limit) && limit > 0)
            return limit;
        if (typeof limit === "string" && /^\d+$/.test(limit))
            return Number(limit);
        throw new Error("Expected sync change-feed positive limit");
    }
    /**
     * Resolves sync change-feed stable high-water mark.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {number} currentServerSequence - Current latest server sequence.
     * @returns {number} - Inclusive upper-bound sequence.
     */
    frontendSyncChangeFeedUpToSequence(params, currentServerSequence) {
        const upToSequence = params.upToSequence ?? params.serverSequence ?? currentServerSequence;
        if (typeof upToSequence === "number" && Number.isInteger(upToSequence) && upToSequence >= 0)
            return Math.min(upToSequence, currentServerSequence);
        if (typeof upToSequence === "string" && /^\d+$/.test(upToSequence))
            return Math.min(Number(upToSequence), currentServerSequence);
        throw new Error("Expected sync change-feed upToSequence");
    }
    /**
     * Runs frontend sync snapshot endpoint.
     * @returns {Promise<void>} - Sync snapshot response.
     */
    async frontendSyncSnapshot() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        const params = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(this.params()));
        const offlineGrant = await this.frontendSyncRequestVerifiedOfflineGrant(params);
        const store = serverChangeFeedStoreForConfiguration(this.getConfiguration());
        const serverSequence = await store.latestSequence();
        const snapshot = await this.frontendSyncSnapshotPayload({ scope: offlineGrant.scopes, serverSequence });
        await this.render({
            json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue({
                snapshot,
                status: "success"
            }, this.transportSerializationOptions()))
        });
    }
    /**
     * Builds a snapshot of sync-enabled frontend model resources at a stable server sequence.
     * @param {object} args - Arguments.
     * @param {number} args.serverSequence - Snapshot sequence.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.scope] - Caller sync scope.
     * @returns {Promise<{resources: Record<string, ReturnType<typeof JSON.parse>>, serverSequence: number}>} - Snapshot payload.
     */
    async frontendSyncSnapshotPayload({ scope, serverSequence }) {
        const syncManifest = frontendModelSyncManifestForBackendProjects(this.getConfiguration().getBackendProjects());
        const resources = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({});
        for (const modelName of Object.keys(syncManifest).sort()) {
            const commandParams = { ...(scope || {}), model: modelName };
            resources[modelName] = await this.withFrontendModelParams(commandParams, async () => {
                return await this.withFrontendModelRequestContext(commandParams, this.response(), async () => {
                    return await this.frontendModelCommandPayload("index") || this.frontendModelErrorPayload("Action halted by beforeAction.");
                });
            });
        }
        return { resources, serverSequence };
    }
    /**
     * Runs frontend api.
     * @returns {Promise<void>} - Shared frontend model API action with batch support.
     */
    async frontendApi() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        const params = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (deserializeFrontendModelTransportValue(this.params()));
        const requests = Array.isArray(params.requests) ? params.requests : [params];
        /**
         * Responses.
         * @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const responses = [];
        for (const requestEntry of requests) {
            const commandType = requestEntry?.commandType;
            const customPath = requestEntry?.customPath;
            const model = requestEntry?.model;
            const payload = requestEntry?.payload;
            const requestId = requestEntry?.requestId;
            if (typeof model !== "string" || model.length < 1) {
                responses.push({
                    requestId,
                    response: this.frontendModelErrorPayload("Expected request model.")
                });
                continue;
            }
            const isBuiltInCommand = ["index", "find", "create", "update", "destroy", "attach", "download", "url", "attachmentList"].includes(commandType);
            if (!isBuiltInCommand && (typeof customPath !== "string" || !customPath.startsWith("/"))) {
                responses.push({
                    requestId,
                    response: this.frontendModelErrorPayload("Expected request customPath.")
                });
                continue;
            }
            try {
                const requestContext = captureFrontendModelRemoteRequestContext(requestEntry?.requestContext);
                let responsePayload;
                if (isBuiltInCommand) {
                    const commandParams = mergeFrontendModelRemoteRequestContext(requestContext, {
                        ...(payload && typeof payload === "object" ? payload : {}),
                        model
                    });
                    responsePayload = await this.withFrontendModelParams(commandParams, async () => {
                        return await this.withFrontendModelRequestContext(commandParams, this.response(), async () => {
                            return await this.frontendModelCommandPayload(commandType);
                        });
                    });
                }
                else {
                    responsePayload = await this.frontendApiCustomCommandPayload({
                        customPath,
                        payload,
                        requestContext
                    });
                }
                responses.push({
                    requestId,
                    response: responsePayload || this.frontendModelErrorPayload("Action halted by beforeAction.")
                });
            }
            catch (error) {
                const errorContext = this.frontendModelEndpointErrorContext({
                    action: "frontendApi",
                    commandType,
                    error,
                    model,
                    requestId
                });
                await this.frontendModelLogEndpointError({ error, errorContext });
                responses.push({
                    requestId,
                    response: await this.frontendModelClientErrorPayloadForError(error, errorContext)
                });
            }
        }
        await this.render({
            json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue({
                responses,
                status: "success"
            }, this.transportSerializationOptions()))
        });
    }
    /**
     * Dispatches a custom frontend-model command through the shared frontend-model API endpoint.
     * @param {object} args - Arguments.
     * @param {string} args.customPath - Custom backend route path.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Request payload.
     * @param {import("./remote-request-context.js").RemoteRequestContext} args.requestContext - Captured remote request context.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Parsed JSON response payload.
     */
    async frontendApiCustomCommandPayload({ customPath, payload, requestContext }) {
        const configuration = this.getConfiguration();
        const response = new Response({ configuration });
        const resolver = new RoutesResolver({
            configuration,
            request: this.getRequest(),
            response
        });
        resolver.params = {};
        const routeHookMatch = await resolver.resolveRouteResolverHooks(customPath);
        const configurationRoutes = configuration.getRoutes();
        const routeMatch = routeHookMatch || !configurationRoutes?.rootRoute ? undefined : resolver.matchPathWithRoutes(configurationRoutes.rootRoute, customPath);
        if (!routeHookMatch && !routeMatch) {
            throw new Error(`No custom frontend model route matched '${customPath}'`);
        }
        const actionParam = routeHookMatch?.action || resolver.params.action;
        const controllerParam = routeHookMatch?.controller || resolver.params.controller;
        const actionValue = typeof actionParam === "string" ? actionParam : (Array.isArray(actionParam) ? actionParam[0] : undefined);
        const controllerValue = typeof controllerParam === "string" ? controllerParam : (Array.isArray(controllerParam) ? controllerParam[0] : undefined);
        if (typeof actionValue !== "string" || actionValue.length < 1 || typeof controllerValue !== "string" || controllerValue.length < 1) {
            throw new Error(`Custom frontend model route matched '${customPath}' without controller/action params`);
        }
        const action = inflection.camelize(actionValue.replaceAll("-", "_").replaceAll("/", "_"), true);
        const controller = controllerValue;
        const controllerPath = routeHookMatch?.controllerPath || `${configuration.getDirectory()}/src/routes/${controller}/controller.js`;
        const viewPath = routeHookMatch?.viewPath || `${configuration.getDirectory()}/src/routes/${controller}`;
        resolver.routeHookControllerClass = routeHookMatch?.controllerClass;
        const controllerClass = await resolver.resolveControllerClass({ controllerPath });
        const controllerParams = mergeFrontendModelRemoteRequestContext(requestContext, {
            ...((payload && typeof payload === "object") ? payload : {}),
            ...resolver.params
        });
        const controllerInstance = new controllerClass({
            action,
            configuration,
            controller,
            params: controllerParams,
            request: /** @type {import("./http-server/client/request.js").default} */ (this.getRequest()),
            response,
            viewPath
        });
        // Preserve the client's own command arguments before route framework params won
        // the `controllerParams` merge above, so a typed command method (`async name(args)`)
        // receives the client payload — not the route's member id / model / controller keys.
        const customCommandController = /** @type {FrontendModelController} */ ( /** @type {unknown} */(controllerInstance));
        customCommandController._frontendModelCustomCommandClientArguments =
            (payload && typeof payload === "object" && !Array.isArray(payload)) ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (payload) : {};
        await this.withFrontendModelRequestContext(controllerParams, response, async () => {
            await controllerInstance._runBeforeCallbacks();
            const controllerMethods = /** @type {Record<string, () => Promise<void> | void>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(controllerInstance));
            await controllerMethods[action]();
        });
        const setCookieHeaders = response.headers["Set-Cookie"] || [];
        for (const setCookieHeader of setCookieHeaders) {
            this.response().addHeader("Set-Cookie", setCookieHeader);
        }
        const responseBody = response.getBody();
        if (typeof responseBody !== "string" || responseBody.length < 1) {
            return {};
        }
        // Preserve nested transport markers so the outer shared frontend-model API
        // can return them unchanged and let the client hydrate once at the edge.
        return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(responseBody));
    }
    /**
     * Runs frontend index.
     * @returns {Promise<void>} - Collection action for frontend model resources.
     */
    async frontendIndex() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("index");
    }
    /**
     * Runs frontend find.
     * @returns {Promise<void>} - Member find action for frontend model resources.
     */
    async frontendFind() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("find");
    }
    /**
     * Runs frontend update.
     * @returns {Promise<void>} - Member update action for frontend model resources.
     */
    async frontendUpdate() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("update");
    }
    /**
     * Runs frontend attach.
     * @returns {Promise<void>} - Member attach action for frontend model resources.
     */
    async frontendAttach() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("attach");
    }
    /**
     * Runs frontend download.
     * @returns {Promise<void>} - Member download action for frontend model resources.
     */
    async frontendDownload() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("download");
    }
    /**
     * Runs frontend url.
     * @returns {Promise<void>} - Member URL action for frontend model resources.
     */
    async frontendUrl() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("url");
    }
    /**
     * Runs frontend create.
     * @returns {Promise<void>} - Member create action for frontend model resources.
     */
    async frontendCreate() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("create");
    }
    /**
     * Runs frontend destroy.
     * @returns {Promise<void>} - Member destroy action for frontend model resources.
     */
    async frontendDestroy() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        await this.frontendModelRenderCommandResponse("destroy");
    }
    /**
     * Runs frontend custom command.
     * @returns {Promise<void>} - Custom collection/member command action for frontend-model resources.
     */
    async frontendCustomCommand() {
        if (this.request().httpMethod() === "OPTIONS") {
            await this.render({ status: 204, json: {} });
            return;
        }
        try {
            const responsePayload = await this.frontendModelCustomCommandPayload();
            await this.render({
                json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(responsePayload, this.transportSerializationOptions()))
            });
        }
        catch (error) {
            const errorContext = this.frontendModelEndpointErrorContext({ action: "frontendCustomCommand", commandType: "custom-command", error });
            await this.frontendModelLogEndpointError({ error, errorContext });
            await this.render({
                json: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (serializeFrontendModelTransportValue(await this.frontendModelClientErrorPayloadForError(error, errorContext), this.transportSerializationOptions()))
            });
        }
    }
    /**
     * Runs frontend model custom command payload.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Response payload.
     */
    async frontendModelCustomCommandPayload() {
        const params = this.frontendModelParams();
        const methodName = params.frontendModelCustomCommandMethodName;
        const scope = params.frontendModelCustomCommandScope;
        if (typeof methodName !== "string" || methodName.length < 1) {
            return this.frontendModelErrorPayload("Expected frontend-model custom command method name.");
        }
        if (scope !== "collection" && scope !== "member") {
            return this.frontendModelErrorPayload("Expected frontend-model custom command scope.");
        }
        const resource = this.frontendModelResourceInstance();
        const command = resource.resourceMethod(methodName);
        if (!command) {
            return this.frontendModelErrorPayload(`Missing frontend-model custom command '${methodName}'.`);
        }
        // Pass the client command arguments as the method's first argument so a command
        // method can take a typed args object (`async name(args)`) and the generated
        // frontend method can forward the backend method's `@param`. `this.params()` is
        // unchanged, so existing parameterless methods keep working. The args are untrusted
        // client input typed only by the declared contract, so methods must still validate.
        const commandArguments = this.frontendModelCustomCommandArguments(params);
        const responsePayload = await command.method.call(command.resource, commandArguments);
        if (!responsePayload || typeof responsePayload !== "object") {
            return { status: "success" };
        }
        return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (await this.autoSerializeFrontendModelsInPayload(responsePayload, 
        /** @type {{serialize: (model: ReturnType<typeof JSON.parse>, action: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>>}} */ (command.resource), methodName));
    }
    /**
     * Resolves the typed argument object passed to a custom command method. On the
     * shared-endpoint path the original client payload was captured before route
     * framework params were merged, so it is returned verbatim (a client `id` survives
     * a member route). On the direct path it falls back to the request params with the
     * framework keys the command route hook injected stripped out.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Deserialized frontend-model params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client command arguments.
     */
    frontendModelCustomCommandArguments(params) {
        if (this._frontendModelCustomCommandClientArguments) {
            return this._frontendModelCustomCommandClientArguments;
        }
        const { action: _action, controller: _controller, frontendModelCustomCommandMethodName: _methodName, frontendModelCustomCommandScope: _scope, model: _model, ...commandArguments } = params;
        return commandArguments;
    }
    /**
     * Walks a custom-command response payload and replaces any backend `Record`
     * instance with the resource's per-action serialized form so handlers can
     * return `{record, status: "ok"}` instead of explicitly calling
     * `await this.serialize(record, action)`. Plain objects, arrays, and
     * primitive values pass through and are later encoded by
     * `serializeFrontendModelTransportValue`.
     * @param {ReturnType<typeof JSON.parse>} value - Payload value.
     * @param {{serialize: (model: ReturnType<typeof JSON.parse>, action: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>>}} resource - Resource instance providing `serialize`.
     * @param {string} action - Custom command method name passed to `resource.serialize` for per-action authorization filtering.
     * @param {WeakSet<object>} [seen] - Recursion stack of plain-object containers currently being walked. Membership is added on entry and removed on exit so a container shared between siblings (i.e. referenced twice but not cyclically) is walked on each reference instead of being short-circuited the second time, which would let backend `Record` instances inside it bypass `resource.serialize`.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Payload with backend `Record` instances replaced by serialized markers.
     */
    async autoSerializeFrontendModelsInPayload(value, resource, action, seen = new WeakSet()) {
        if (value === null || value === undefined) {
            return value;
        }
        if (isBackendModelInstance(value)) {
            const richSerialized = await resource.serialize(value, action);
            const modelName = value.getModelClass().getModelName();
            // Wrap the resource-serialized payload in the frontend_model transport
            // marker. Marker-based decoding routes through `instantiateFromResponse`,
            // so abilities / queryData / associationCounts / preloadedRelationships
            // baked into the rich attributes by `resource.serialize` are restored on
            // the client without callers needing to wrap models manually.
            return {
                __velocious_type: "frontend_model",
                attributes: richSerialized,
                modelName
            };
        }
        if (Array.isArray(value)) {
            /**
             * Result.
             * @type {Array<ReturnType<typeof JSON.parse>>} */
            const result = [];
            for (const entry of value) {
                result.push(await this.autoSerializeFrontendModelsInPayload(entry, resource, action, seen));
            }
            return result;
        }
        if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
            const container = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (value);
            if (seen.has(container)) {
                // Cyclic back-reference along the current recursion path; the
                // ancestor frame is still walking this container and will produce
                // its serialized form. Returning the original container here
                // breaks the cycle without bypassing the walker for siblings that
                // share a non-cyclic reference (those re-enter the branch below
                // because the container is removed from `seen` on stack exit).
                return container;
            }
            seen.add(container);
            try {
                /**
                 * Result.
                 * @type {Record<string, ReturnType<typeof JSON.parse>>} */
                const result = {};
                for (const [key, nested] of Object.entries(container)) {
                    // `assignSafeProperty` stores keys like `__proto__` as own
                    // data properties instead of invoking the prototype setter,
                    // so a custom-command response that echoes parsed client
                    // input cannot pollute `Object.prototype` here. The transport
                    // serializer applies the same protection on its own pass; we
                    // just preserve it across the auto-serialize walk.
                    assignSafeProperty(result, key, await this.autoSerializeFrontendModelsInPayload(nested, resource, action, seen));
                }
                return result;
            }
            finally {
                seen.delete(container);
            }
        }
        return value;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3RDLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sVUFBVSxNQUFNLGlCQUFpQixDQUFBO0FBQ3hDLE9BQU8seUJBQXlCLE1BQU0sNENBQTRDLENBQUE7QUFDbEYsT0FBTyxRQUFRLE1BQU0sa0NBQWtDLENBQUE7QUFDdkQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUNBQXlDLENBQUE7QUFDM0csT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFFLHlCQUF5QixFQUFFLHVDQUF1QyxFQUFFLDJDQUEyQyxFQUFDLE1BQU0sMENBQTBDLENBQUE7QUFDcFEsT0FBTyxFQUFDLCtCQUErQixFQUFFLGtCQUFrQixFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHFDQUFxQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDbEYsT0FBTyxFQUFDLHNCQUFzQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDdEYsT0FBTyxFQUFDLHVCQUF1QixFQUFFLGNBQWMsSUFBSSxtQkFBbUIsRUFBRSxjQUFjLElBQUksbUJBQW1CLEVBQUUsY0FBYyxJQUFJLG1CQUFtQixFQUFFLGdCQUFnQixJQUFJLHFCQUFxQixFQUFFLHVCQUF1QixJQUFJLDRCQUE0QixFQUFFLGFBQWEsSUFBSSxrQkFBa0IsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ2hVLE9BQU8sRUFBQyxrQkFBa0IsRUFBRSxzQ0FBc0MsRUFBRSxzQkFBc0IsRUFBRSxvQ0FBb0MsRUFBQyxNQUFNLDhDQUE4QyxDQUFBO0FBQ3JMLE9BQU8s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QUFTLENBQUMsQ0FBQTtZQUN4QixDQUFDO1FBQ0gsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7cmFuZG9tVVVJRH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IENvbnRyb2xsZXIgZnJvbSBcIi4vY29udHJvbGxlci5qc1wiXG5pbXBvcnQgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCBSZXNwb25zZSBmcm9tIFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3R9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9idWlsdC1pbi1yZXNvdXJjZXMuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgsIGZyb250ZW5kTW9kZWxSZXNvdXJjZXNGb3JCYWNrZW5kUHJvamVjdCwgZnJvbnRlbmRNb2RlbFN5bmNNYW5pZmVzdEZvckJhY2tlbmRQcm9qZWN0c30gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtjcmVhdGVPZmZsaW5lR3JhbnRGcm9tQm9vdHN0cmFwLCB2ZXJpZnlPZmZsaW5lR3JhbnR9IGZyb20gXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiXG5pbXBvcnQge3NlcnZlckNoYW5nZUZlZWRTdG9yZUZvckNvbmZpZ3VyYXRpb259IGZyb20gXCIuL3N5bmMvc2VydmVyLWNoYW5nZS1mZWVkLmpzXCJcbmltcG9ydCB7bXV0YXRpb25JZGVtcG90ZW5jeUtleSwgdmVyaWZ5U2lnbmVkTXV0YXRpb259IGZyb20gXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCJcbmltcG9ydCB7RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IsIG5vcm1hbGl6ZUdyb3VwIGFzIG5vcm1hbGl6ZVF1ZXJ5R3JvdXAsIG5vcm1hbGl6ZUpvaW5zIGFzIG5vcm1hbGl6ZVF1ZXJ5Sm9pbnMsIG5vcm1hbGl6ZVBsdWNrIGFzIG5vcm1hbGl6ZVF1ZXJ5UGx1Y2ssIG5vcm1hbGl6ZVByZWxvYWQgYXMgbm9ybWFsaXplUXVlcnlQcmVsb2FkLCBub3JtYWxpemVTZWFyY2hPcGVyYXRvciBhcyBub3JtYWxpemVRdWVyeVNlYXJjaE9wZXJhdG9yLCBub3JtYWxpemVTb3J0IGFzIG5vcm1hbGl6ZVF1ZXJ5U29ydH0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3F1ZXJ5LmpzXCJcbmltcG9ydCB7YXNzaWduU2FmZVByb3BlcnR5LCBkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSwgaXNCYWNrZW5kTW9kZWxJbnN0YW5jZSwgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlfSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvdHJhbnNwb3J0LXNlcmlhbGl6YXRpb24uanNcIlxuaW1wb3J0IHtyZXF1ZXN0RGV0YWlsc30gZnJvbSBcIi4vZXJyb3ItcmVwb3J0aW5nL3JlcXVlc3QtZGV0YWlscy5qc1wiXG5pbXBvcnQgUm91dGVzUmVzb2x2ZXIgZnJvbSBcIi4vcm91dGVzL3Jlc29sdmVyLmpzXCJcbmltcG9ydCB7VmFsaWRhdGlvbkVycm9yfSBmcm9tIFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIlxuaW1wb3J0IFJlY29yZE5vdEZvdW5kRXJyb3IgZnJvbSBcIi4vZGF0YWJhc2UvcmVjb3JkL3JlY29yZC1ub3QtZm91bmQtZXJyb3IuanNcIlxuaW1wb3J0IHtjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0LCBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dH0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIlxuaW1wb3J0IHsgbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlIH0gZnJvbSBcIi4vZGF0YWJhc2UvZGF0ZXRpbWUtc3RvcmFnZS5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCBpc0RhdGUgZnJvbSBcIi4vdXRpbHMvaXMtZGF0ZS5qc1wiXG5pbXBvcnQgaXNQbGFpbk9iamVjdCBmcm9tIFwiLi91dGlscy9wbGFpbi1vYmplY3QuanNcIlxuaW1wb3J0IHtSYW5zYWNrUXVlcnlFcnJvciwgbm9ybWFsaXplUmFuc2Fja0dyb3VwLCBwYXJzZVJhbnNhY2tTb3J0fSBmcm9tIFwiLi91dGlscy9yYW5zYWNrLmpzXCJcblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsU2VhcmNoIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFNvcnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEdyb3VwIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsR3JvdXBcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBncm91cCBieS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFBsdWNrIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUGx1Y2tcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBwbHVjay5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxQYWdpbmF0aW9uXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGxpbWl0IC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb2Zmc2V0IC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGFnZSAtIDEtYmFzZWQgcGFnZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHBlclBhZ2UgLSBQYWdlIHNpemUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRDb250ZXh0ICYge1xuICogICBhY3Rpb246IHN0cmluZyxcbiAqICAgZXhwZWN0ZWRFcnJvcjogYm9vbGVhbixcbiAqICAgZnJvbnRlbmRNb2RlbEVuZHBvaW50OiB0cnVlXG4gKiB9fSBGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHRcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSW5kZXhRdWVyeU9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVBhZ2luYXRpb25dIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBwYWdpbmF0aW9uIHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2luY2x1ZGVTb3J0XSAtIFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgc29ydCBwYXJhbXMgc2hvdWxkIGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBbcmVzb3VyY2VdIC0gUmVzb3VyY2UgcHJvdmlkaW5nIHF1ZXJ5IGhvb2tzLlxuICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCAmIFJlY29yZDxzeW1ib2wsIFNldDxzdHJpbmc+IHwgdW5kZWZpbmVkPn0gRnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEgKi9cbi8qKlxuICogQGNhbGxiYWNrIEZyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2tcbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZSBiZWluZyBzZXJpYWxpemVkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdCB8IG51bGx9IHJlc291cmNlIC0gUmVzb2x2ZWQgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZSwgaWYgYW55LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBwcmVsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBzdHJpbmdbXSB8IGJvb2xlYW4gfCB1bmRlZmluZWQgfCBudWxsfSBwcmVsb2FkIC0gUHJlbG9hZCBzaG9ydGhhbmQuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbH0gLSBOb3JtYWxpemVkIHByZWxvYWQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQcmVsb2FkKHByZWxvYWQpIHtcbiAgaWYgKCFwcmVsb2FkKSByZXR1cm4gbnVsbFxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVF1ZXJ5UHJlbG9hZChwcmVsb2FkKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB0aHJvd0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yRm9yUGFyc2VyRXJyb3IoZXJyb3IpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBqb2lucy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGpvaW5zIC0gSm9pbnMgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIE5vcm1hbGl6ZWQgcmVsYXRpb25zaGlwLW9iamVjdCBqb2lucy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEpvaW5zKGpvaW5zKSB7XG4gIGlmICgham9pbnMpIHJldHVybiBudWxsXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gbm9ybWFsaXplUXVlcnlKb2lucyhqb2lucylcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgc2VsZWN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2VsZWN0IC0gU2VsZWN0IHBheWxvYWQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFtyb290TW9kZWxOYW1lXSAtIE9wdGlvbmFsIHJvb3QgbW9kZWwgbmFtZSBmb3Igc2hvcnRoYW5kIHBheWxvYWRzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB8IG51bGx9IC0gTm9ybWFsaXplZCBtb2RlbC1uYW1lIGtleWVkIHNlbGVjdCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxTZWxlY3Qoc2VsZWN0LCByb290TW9kZWxOYW1lID0gbnVsbCkge1xuICBpZiAoIXNlbGVjdCkgcmV0dXJuIG51bGxcblxuICBpZiAodHlwZW9mIHNlbGVjdCA9PT0gXCJzdHJpbmdcIikge1xuICAgIGlmICghcm9vdE1vZGVsTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlbGVjdCBzaG9ydGhhbmQgd2l0aG91dCByb290IG1vZGVsIG5hbWVcIilcbiAgICB9XG5cbiAgICByZXR1cm4ge1tyb290TW9kZWxOYW1lXTogW3NlbGVjdF19XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3QpKSB7XG4gICAgaWYgKCFyb290TW9kZWxOYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VsZWN0IHNob3J0aGFuZCB3aXRob3V0IHJvb3QgbW9kZWwgbmFtZVwiKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3QpIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWxlY3QgYXR0cmlidXRlIGZvciAke3Jvb3RNb2RlbE5hbWV9OiAke3R5cGVvZiBhdHRyaWJ1dGVOYW1lfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtbcm9vdE1vZGVsTmFtZV06IEFycmF5LmZyb20obmV3IFNldChzZWxlY3QpKX1cbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChzZWxlY3QpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VsZWN0IHR5cGU6ICR7dHlwZW9mIHNlbGVjdH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgc2VsZWN0VmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNlbGVjdCkpIHtcbiAgICBpZiAodHlwZW9mIHNlbGVjdFZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBub3JtYWxpemVkW21vZGVsTmFtZV0gPSBbc2VsZWN0VmFsdWVdXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzZWxlY3RWYWx1ZSkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlbGVjdCB2YWx1ZSBmb3IgJHttb2RlbE5hbWV9OiAke3R5cGVvZiBzZWxlY3RWYWx1ZX1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3RWYWx1ZSkge1xuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlbGVjdCBhdHRyaWJ1dGUgZm9yICR7bW9kZWxOYW1lfTogJHt0eXBlb2YgYXR0cmlidXRlTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRbbW9kZWxOYW1lXSA9IEFycmF5LmZyb20obmV3IFNldChzZWxlY3RWYWx1ZSkpXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG5jb25zdCBmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2wgPSBTeW1ib2woXCJmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNcIilcbmNvbnN0IGZyb250ZW5kTW9kZWxHcm91cGVkQ29sdW1uc1N5bWJvbCA9IFN5bWJvbChcImZyb250ZW5kTW9kZWxHcm91cGVkQ29sdW1uc1wiKVxuY29uc3QgZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbCA9IFN5bWJvbChcImZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hcIilcbmNvbnN0IGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JNZXNzYWdlID0gXCJSZXF1ZXN0IGZhaWxlZC5cIlxuXG4vKipcbiAqIEJ1aWxkcyBhIGNsaWVudC1zYWZlIHN5bmMgcmVwbGF5IHZhbGlkYXRpb24gZXJyb3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIENsaWVudC1zYWZlIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gW2NhdXNlXSAtIE9yaWdpbmFsIGNhdXNlLlxuICogQHJldHVybnMge1ZlbG9jaW91c0Vycm9yfSAtIENsaWVudC1zYWZlIHJlcGxheSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKG1lc3NhZ2UsIGNhdXNlKSB7XG4gIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKG1lc3NhZ2UsIHtcbiAgICBjYXVzZSxcbiAgICBjb2RlOiBcImZyb250ZW5kX3N5bmNfcmVwbGF5X2Vycm9yXCJcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHF1ZXJ5IG1ldGFkYXRhLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGF9IC0gUXVlcnkgbWV0YWRhdGEgYWNjZXNzIGhlbHBlci5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGF9ICovIChxdWVyeSlcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBjbGllbnQtc2FmZSBmcm9udGVuZC1tb2RlbCBxdWVyeSBlcnJvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNFcnJvcn0gQ2xpZW50LXNhZmUgcXVlcnkgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKG1lc3NhZ2UpIHtcbiAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUobWVzc2FnZSwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtcXVlcnktZXJyb3JcIn0pXG59XG5cbi8qKlxuICogVGhyb3dzIGEgY2xpZW50LXNhZmUgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZXJyb3IgZm9yIHR5cGVkIHF1ZXJ5IHBhcnNlciBlcnJvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEVycm9yIHJhaXNlZCB3aGlsZSBub3JtYWxpemluZyBjbGllbnQgcXVlcnkgcGFyYW1zLlxuICogQHJldHVybnMge25ldmVyfSBBbHdheXMgdGhyb3dzLlxuICovXG5mdW5jdGlvbiB0aHJvd0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yRm9yUGFyc2VyRXJyb3IoZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IgfHwgZXJyb3IgaW5zdGFuY2VvZiBSYW5zYWNrUXVlcnlFcnJvcikge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGVycm9yLm1lc3NhZ2UpXG4gIH1cblxuICB0aHJvdyBlcnJvclxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGVycm9yIGNhcnJpZXMgYW4gYGVycm9yLnZlbG9jaW91c2AgbWV0YWRhdGEgYmFnLiBUaGVcbiAqIHByZXNlbmNlIG9mIGFueSBzdWNoIGJhZyBtYXJrcyB0aGUgZXJyb3IgYXMgXCJhbm5vdGF0ZWQgYnkgdGhlXG4gKiBkZXZlbG9wZXIgZm9yIHRoZSBmcm9udGVuZFwiIOKAlCB0aGUgZnJhbWV3b3JrIHRyZWF0cyBpdCBhc1xuICogdXNlci1mYWNpbmc6IHN1cmZhY2UgdGhlIG1lc3NhZ2UsIGZvcndhcmQgdGhlIG1ldGFkYXRhLCBhbmQgc2tpcFxuICogdGhlIG5vaXN5IGVuZHBvaW50LWVycm9yIGxvZy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgZXJyb3IgaGFzIFZlbG9jaW91cyBmcm9udGVuZCBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEoZXJyb3IpIHtcbiAgaWYgKCFlcnJvciB8fCB0eXBlb2YgZXJyb3IgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIC8vIFJ1bnRpbWUgY2hlY2tzIGFib3ZlIG5hcnJvdyB0aGlzIGNhdWdodCB2YWx1ZSB0byB0aGUgbWV0YWRhdGEgcmVjb3JkIHNoYXBlLlxuICBjb25zdCBlcnJvclJlY29yZCA9IC8qKiBAdHlwZSB7e3ZlbG9jaW91cz86IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9fSAqLyAoZXJyb3IpXG5cbiAgcmV0dXJuIGlzUGxhaW5PYmplY3QoZXJyb3JSZWNvcmQudmVsb2Npb3VzKVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGVycm9yIGlzIGFuIGV4cGVjdGVkIGZyb250ZW5kLW1vZGVsIHVzZXItZmxvdyBmYWlsdXJlLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBlcnJvciBpcyBleHBlY3RlZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV4cGVjdGVkRXJyb3IoZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmVjb3JkTm90Rm91bmRFcnJvcikgcmV0dXJuIHRydWVcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHJldHVybiB0cnVlXG4gIGlmIChmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB2ZWxvY2lvdXMgbWV0YWRhdGEgZm9yIGVycm9yLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkIHwgbnVsbH0gRnJvbnRlbmQtbW9kZWwgVmVsb2Npb3VzIG1ldGFkYXRhIHdoZW4gcHJlc2VudC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFZlbG9jaW91c01ldGFkYXRhRm9yRXJyb3IoZXJyb3IpIHtcbiAgY29uc3QgZXJyb3JDb2RlID0gZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UgJiYgdHlwZW9mIGVycm9yLmNvZGUgPT09IFwic3RyaW5nXCIgJiYgZXJyb3IuY29kZS5sZW5ndGggPiAwXG4gICAgPyBlcnJvci5jb2RlXG4gICAgOiBudWxsXG5cbiAgaWYgKCFmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikpIHtcbiAgICByZXR1cm4gZXJyb3JDb2RlID8ge2NvZGU6IGVycm9yQ29kZX0gOiBudWxsXG4gIH1cblxuICAvLyBmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YSBndWFyZHMgdGhlIGNhdWdodCB2YWx1ZSBiZWZvcmUgdGhpcyBjYXN0LlxuICBjb25zdCBlcnJvclJlY29yZCA9IC8qKiBAdHlwZSB7e3ZlbG9jaW91czogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH19ICovIChlcnJvcilcbiAgY29uc3QgbWV0YWRhdGEgPSBlcnJvclJlY29yZC52ZWxvY2lvdXNcblxuICByZXR1cm4gZXJyb3JDb2RlID8gey4uLm1ldGFkYXRhLCBjb2RlOiBlcnJvckNvZGV9IDogbWV0YWRhdGFcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsaWVudCBtZXNzYWdlIGZvciBlcnJvci5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzIC0gV2hldGhlciB1bmV4cGVjdGVkIGVycm9yIG1lc3NhZ2VzIG1heSBiZSBleHBvc2VkLlxuICogQHJldHVybnMge3N0cmluZ30gLSBNZXNzYWdlIHNhZmUgdG8gcmV0dXJuIHRvIEFQSSBjbGllbnRzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ2xpZW50TWVzc2FnZUZvckVycm9yKGVycm9yLCBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cykge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZWNvcmROb3RGb3VuZEVycm9yKSB7XG4gICAgcmV0dXJuIFwiUmVjb3JkIG5vdCBmb3VuZC5cIlxuICB9XG5cbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgcmV0dXJuIGVycm9yLm1lc3NhZ2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRpb24gZmFpbHVyZXMgYXJlIGV4cGVjdGVkIHVzZXItZmxvdyBlcnJvcnMuIEFsd2F5cyBmb3J3YXJkIHRoZVxuICAvLyB2YWxpZGF0aW9uIHN1bW1hcnkgc28gdGhlIGNsaWVudCBzaG93cyB0aGUgcmVhbCByZWFzb24gKGUuZy4gXCJOYW1lIGNhbid0XG4gIC8vIGJlIGJsYW5rXCIpIGluc3RlYWQgb2YgdGhlIGdlbmVyaWMgXCJSZXF1ZXN0IGZhaWxlZC5cIiBtZXNzYWdlLCByZWdhcmRsZXNzIG9mXG4gIC8vIHdoZXRoZXIgdGhlIHJhaXNpbmcgY29kZSBhbHNvIGF0dGFjaGVkIGVycm9yLnZlbG9jaW91cyBtZXRhZGF0YS5cbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yLm1lc3NhZ2VcbiAgfVxuXG4gIGlmIChmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikgJiYgZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIHJldHVybiBlcnJvci5tZXNzYWdlXG4gIH1cblxuICBpZiAoZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgJiYgZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yLm1lc3NhZ2VcblxuICByZXR1cm4gZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvck1lc3NhZ2Vcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGRlYnVnIHBheWxvYWQgZm9yIGVycm9yLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gLSBPcHRpb25hbCBpbnRlcm5hbCBlcnJvciBkZXRhaWxzIHdoZW4gY2xpZW50IGV4cG9zdXJlIGlzIGVuYWJsZWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxEZWJ1Z1BheWxvYWRGb3JFcnJvcih7Y29uZmlndXJhdGlvbiwgZXJyb3J9KSB7XG4gIGlmICghY29uZmlndXJhdGlvbi5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFJlY29yZE5vdEZvdW5kRXJyb3IpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGlmIChmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGNvbnN0IGRlYnVnRXJyb3JDbGFzcyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubmFtZVxuICAgID8gZXJyb3IubmFtZVxuICAgIDogdHlwZW9mIGVycm9yXG4gIGNvbnN0IGRlYnVnRXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgID8gZXJyb3IubWVzc2FnZVxuICAgIDogU3RyaW5nKGVycm9yKVxuICBjb25zdCBkZWJ1Z0JhY2t0cmFjZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgdHlwZW9mIGVycm9yLnN0YWNrID09PSBcInN0cmluZ1wiICYmIGVycm9yLnN0YWNrLmxlbmd0aCA+IDBcbiAgICA/IGVycm9yLnN0YWNrLnNwbGl0KFwiXFxuXCIpXG4gICAgOiB1bmRlZmluZWRcblxuICByZXR1cm4ge1xuICAgIGRlYnVnRXJyb3JDbGFzcyxcbiAgICBkZWJ1Z0Vycm9yTWVzc2FnZSxcbiAgICAuLi4oZGVidWdCYWNrdHJhY2UgPyB7ZGVidWdCYWNrdHJhY2V9IDoge30pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBzZWFyY2hlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNlYXJjaGVzIC0gU2VhcmNoIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAtIE5vcm1hbGl6ZWQgc2VhcmNoZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxTZWFyY2hlcyhzZWFyY2hlcykge1xuICBpZiAoIXNlYXJjaGVzKSByZXR1cm4gW11cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoc2VhcmNoZXMpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VhcmNoZXMgdHlwZTogJHt0eXBlb2Ygc2VhcmNoZXN9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVkLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBzZWFyY2hlcykge1xuICAgIGlmICghaXNQbGFpbk9iamVjdChzZWFyY2gpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWFyY2ggZW50cnkgdHlwZTogJHt0eXBlb2Ygc2VhcmNofWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHNlYXJjaC5wYXRoXG4gICAgY29uc3QgY29sdW1uID0gc2VhcmNoLmNvbHVtblxuICAgIGNvbnN0IG9wZXJhdG9yID0gc2VhcmNoLm9wZXJhdG9yXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwiSW52YWxpZCBzZWFyY2ggcGF0aDogZXhwZWN0ZWQgYW4gYXJyYXlcIilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhdGhFbnRyeSBvZiBwYXRoKSB7XG4gICAgICBpZiAodHlwZW9mIHBhdGhFbnRyeSAhPT0gXCJzdHJpbmdcIiB8fCBwYXRoRW50cnkubGVuZ3RoIDwgMSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VhcmNoIHBhdGggZW50cnk6IGV4cGVjdGVkIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbHVtbiAhPT0gXCJzdHJpbmdcIiB8fCBjb2x1bW4ubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlYXJjaCBjb2x1bW46IGV4cGVjdGVkIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIG9wZXJhdG9yICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWFyY2ggb3BlcmF0b3I6ICR7b3BlcmF0b3J9YClcbiAgICB9XG5cbiAgICBsZXQgbm9ybWFsaXplZE9wZXJhdG9yXG5cbiAgICB0cnkge1xuICAgICAgbm9ybWFsaXplZE9wZXJhdG9yID0gbm9ybWFsaXplUXVlcnlTZWFyY2hPcGVyYXRvcihvcGVyYXRvcilcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWQucHVzaCh7XG4gICAgICBjb2x1bW4sXG4gICAgICBvcGVyYXRvcjogbm9ybWFsaXplZE9wZXJhdG9yLFxuICAgICAgcGF0aDogWy4uLnBhdGhdLFxuICAgICAgdmFsdWU6IHNlYXJjaC52YWx1ZVxuICAgIH0pXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHdoZXJlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gd2hlcmUgLSBXaGVyZSBwYXlsb2FkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gTm9ybWFsaXplZCB3aGVyZSBoYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmUod2hlcmUpIHtcbiAgaWYgKCF3aGVyZSkgcmV0dXJuIG51bGxcblxuICBpZiAoIWlzUGxhaW5PYmplY3Qod2hlcmUpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgd2hlcmUgdHlwZTogJHt0eXBlb2Ygd2hlcmV9YClcbiAgfVxuXG4gIHJldHVybiB3aGVyZVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJhbnNhY2suXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByYW5zYWNrIC0gUmFuc2FjayBwYXlsb2FkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gTm9ybWFsaXplZCBSYW5zYWNrIGhhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSYW5zYWNrKHJhbnNhY2spIHtcbiAgaWYgKCFyYW5zYWNrKSByZXR1cm4gbnVsbFxuXG4gIGlmICghaXNQbGFpbk9iamVjdChyYW5zYWNrKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHJhbnNhY2sgdHlwZTogJHt0eXBlb2YgcmFuc2Fja31gKVxuICB9XG5cbiAgcmV0dXJuIHJhbnNhY2tcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBpbnRlZ2VyIHBhcmFtLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUGFyYW0gbmFtZSBmb3IgZXJyb3JzLlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbiAtIE1pbmltdW0gYWxsb3dlZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgaW50ZWdlci5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbSh2YWx1ZSwgbmFtZSwgbWluKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtuYW1lfTogZXhwZWN0ZWQgaW50ZWdlciBudW1iZXJgKVxuICB9XG5cbiAgaWYgKHZhbHVlIDwgbWluKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtuYW1lfTogZXhwZWN0ZWQgdmFsdWUgPj0gJHttaW59YClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHBhZ2luYXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MubGltaXQgLSBMaW1pdCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5vZmZzZXQgLSBPZmZzZXQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGFnZSAtIFBhZ2UgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGVyUGFnZSAtIFBlci1wYWdlIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBhZ2luYXRpb259IC0gTm9ybWFsaXplZCBwYWdpbmF0aW9uIGRhdGEuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtsaW1pdCwgb2Zmc2V0LCBwYWdlLCBwZXJQYWdlfSkge1xuICByZXR1cm4ge1xuICAgIGxpbWl0OiBub3JtYWxpemVGcm9udGVuZE1vZGVsSW50ZWdlclBhcmFtKGxpbWl0LCBcImxpbWl0XCIsIDApLFxuICAgIG9mZnNldDogbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbShvZmZzZXQsIFwib2Zmc2V0XCIsIDApLFxuICAgIHBhZ2U6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0ocGFnZSwgXCJwYWdlXCIsIDEpLFxuICAgIHBlclBhZ2U6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0ocGVyUGFnZSwgXCJwZXJQYWdlXCIsIDEpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBkaXN0aW5jdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGRpc3RpbmN0IC0gRGlzdGluY3QgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtib29sZWFuIHwgbnVsbH0gLSBOb3JtYWxpemVkIGRpc3RpbmN0IGZsYWcgd2hlbiBwcm92aWRlZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbERpc3RpbmN0KGRpc3RpbmN0KSB7XG4gIGlmIChkaXN0aW5jdCA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gIGlmICh0eXBlb2YgZGlzdGluY3QgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgZGlzdGluY3Q6IGV4cGVjdGVkIGJvb2xlYW5gKVxuICB9XG5cbiAgcmV0dXJuIGRpc3RpbmN0XG59XG5cbi8qKlxuICogUnVucyBidWlsZCBmcm9udGVuZCBtb2RlbCBqb2luIG9iamVjdCBmcm9tIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEpvaW4gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBidWlsZEZyb250ZW5kTW9kZWxKb2luT2JqZWN0RnJvbVBhdGgocGF0aCkge1xuICAvKipcbiAgICogSm9pbiBvYmplY3QuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IGpvaW5PYmplY3QgPSB7fVxuICAvKipcbiAgICogQ3VycmVudCBub2RlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgY3VycmVudE5vZGUgPSBqb2luT2JqZWN0XG5cbiAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHBhdGgpIHtcbiAgICBjdXJyZW50Tm9kZVtyZWxhdGlvbnNoaXBOYW1lXSA9IHt9XG4gICAgY3VycmVudE5vZGUgPSBjdXJyZW50Tm9kZVtyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgcmV0dXJuIGpvaW5PYmplY3Rcbn1cblxuLyoqXG4gKiBCdWlsZCBhIHN1Y2Nlc3NmdWwgc2luZ2xlLW1vZGVsIGZyb250ZW5kLW1vZGVsIHJlc3BvbnNlIHBheWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbW9kZWwgLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7e21vZGVsOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN0YXR1czogXCJzdWNjZXNzXCJ9fSAtIFN1Y2Nlc3MgcmVzcG9uc2UgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFNlcmlhbGl6ZWRNb2RlbFN1Y2Nlc3MobW9kZWwpIHtcbiAgcmV0dXJuIHttb2RlbCwgc3RhdHVzOiBcInN1Y2Nlc3NcIn1cbn1cblxuLyoqXG4gKiBSZXNvbHZlIGFuZCB2YWxpZGF0ZSBhdHRhY2htZW50IHBhcmFtcyBzaGFyZWQgYnkgYXR0YWNobWVudCBjb21tYW5kcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBGcm9udGVuZC1tb2RlbCByZXF1ZXN0IHBhcmFtcy5cbiAqIEByZXR1cm5zIHt7YXR0YWNobWVudElkOiBzdHJpbmcgfCB1bmRlZmluZWQsIGF0dGFjaG1lbnROYW1lOiBzdHJpbmd9IHwgc3RyaW5nfSAtIEF0dGFjaG1lbnQgcGFyYW1zIG9yIHZhbGlkYXRpb24gZXJyb3IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKSB7XG4gIGNvbnN0IGF0dGFjaG1lbnROYW1lID0gcGFyYW1zLmF0dGFjaG1lbnROYW1lXG5cbiAgaWYgKHR5cGVvZiBhdHRhY2htZW50TmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBhdHRhY2htZW50TmFtZS5sZW5ndGggPCAxKSB7XG4gICAgcmV0dXJuIFwiRXhwZWN0ZWQgYXR0YWNobWVudE5hbWUuXCJcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYXR0YWNobWVudElkOiB0eXBlb2YgcGFyYW1zLmF0dGFjaG1lbnRJZCA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5hdHRhY2htZW50SWQgOiB1bmRlZmluZWQsXG4gICAgYXR0YWNobWVudE5hbWVcbiAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3QgbXV0YXRpb24gYXR0cmlidXRlcyBzaGFyZWQgYnkgY3JlYXRlIGFuZCB1cGRhdGUgY29tbWFuZHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gRnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBwYXJhbXMuXG4gKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXR0YWNobWVudHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGwsIG5lc3RlZEF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IHwgc3RyaW5nfSAtIE11dGF0aW9uIGF0dHJpYnV0ZXMgb3IgdmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcykge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gcGFyYW1zLmF0dHJpYnV0ZXNcblxuICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0cmlidXRlcykpIHtcbiAgICByZXR1cm4gXCJFeHBlY3RlZCBtb2RlbCBhdHRyaWJ1dGVzLlwiXG4gIH1cblxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgcmVndWxhckF0dHJpYnV0ZXMgPSB7fVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHJldHVybiBgSW52YWxpZCBuZXN0ZWQgYXR0cmlidXRlcyBrZXk6ICR7YXR0cmlidXRlTmFtZX1gXG4gICAgICBuZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2Uge1xuICAgICAgcmVndWxhckF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cbiAgfVxuXG4gIGlmIChwYXJhbXMubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHBhcmFtcy5uZXN0ZWRBdHRyaWJ1dGVzKSkgcmV0dXJuIFwiRXhwZWN0ZWQgbmVzdGVkQXR0cmlidXRlcyB0byBiZSBhbiBvYmplY3QuXCJcblxuICAgIE9iamVjdC5hc3NpZ24obmVzdGVkQXR0cmlidXRlcywgcGFyYW1zLm5lc3RlZEF0dHJpYnV0ZXMpXG4gIH1cblxuICBpZiAocGFyYW1zLmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQgJiYgIWlzUGxhaW5PYmplY3QocGFyYW1zLmF0dGFjaG1lbnRzKSkge1xuICAgIHJldHVybiBcIkV4cGVjdGVkIGF0dGFjaG1lbnRzIHRvIGJlIGFuIG9iamVjdC5cIlxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhdHRyaWJ1dGVzOiByZWd1bGFyQXR0cmlidXRlcyxcbiAgICBhdHRhY2htZW50czogcGFyYW1zLmF0dGFjaG1lbnRzID09PSB1bmRlZmluZWQgPyBudWxsIDogcGFyYW1zLmF0dGFjaG1lbnRzLFxuICAgIG5lc3RlZEF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBuZXN0ZWRBdHRyaWJ1dGVzIDogbnVsbFxuICB9XG59XG5cbi8qKiBDb250cm9sbGVyIHdpdGggYnVpbHQtaW4gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgYWN0aW9ucy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxDb250cm9sbGVyIGV4dGVuZHMgQ29udHJvbGxlciB7XG4gIC8qKlxuICAgKiBGcm9udGVuZCBtb2RlbCBwYXJhbXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsUGFyYW1zID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBGcm9udGVuZCBtb2RlbCBwYXJhbXMgb3ZlcnJpZGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIEZyb250ZW5kIG1vZGVsIGFiaWxpdHkgb3ZlcnJpZGUuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogT3JpZ2luYWwgZGVzZXJpYWxpemVkIGN1c3RvbS1jb21tYW5kIGNsaWVudCBwYXlsb2FkLCBjYXB0dXJlZCBiZWZvcmUgcm91dGVcbiAgICogZnJhbWV3b3JrIHBhcmFtcyBhcmUgbWVyZ2VkIGluLCBzbyBhIHR5cGVkIGNvbW1hbmQgbWV0aG9kIHJlY2VpdmVzIHRoZSBjbGllbnQnc1xuICAgKiBvd24gYXJndW1lbnRzIHJhdGhlciB0aGFuIHRoZSByb3V0ZSBtZXRhZGF0YS4gT25seSBzZXQgb24gdGhlIHNoYXJlZC1lbmRwb2ludCBwYXRoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRDbGllbnRBcmd1bWVudHMgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIFJlcXVlc3Qtc2NvcGVkIGNhY2hlIGZvciBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlcy5cbiAgICogS2V5ZWQgYnkgbW9kZWwgY2xhc3MsIHRoZW4gYnkgd2hldGhlciB0aGUgcmVzb3VyY2UgaXMgZm9yIGEgcmVsYXRlZCBtb2RlbFxuICAgKiAoc28gc2VsZi1yZWZlcmVudGlhbCByZWxhdGlvbnNoaXBzIGRvIG5vdCBhY2NpZGVudGFsbHkgcmV1c2Ugcm9vdCBwYXJhbXMpLlxuICAgKiBAdHlwZSB7TWFwPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBNYXA8Ym9vbGVhbiwgaW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQ+PiB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIE9wdGlvbmFsIHBlci1pbnN0YW5jZSBob29rIGludm9rZWQgZm9yIGV2ZXJ5IHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2VcbiAgICogcmVzb2x1dGlvbi4gSW50ZW5kZWQgZm9yIHRlc3RzIGFuZCBiZW5jaG1hcmtzOyBhYnNlbnQgaW4gcHJvZHVjdGlvbi5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEZWNvZGVkIHJlcXVlc3QgcGFyYW1zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFBhcmFtcygpIHtcbiAgICBpZiAodGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlXG4gICAgfVxuXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtcyB8fD0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcblxuICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGZyb250ZW5kIG1vZGVsIHBhcmFtcy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFRlbXBvcmFyeSBmcm9udGVuZCBtb2RlbCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBleGVjdXRlZCB3aXRoIHRlbXBvcmFyeSBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHdpdGhGcm9udGVuZE1vZGVsUGFyYW1zKHBhcmFtcywgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91c092ZXJyaWRlID0gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlXG4gICAgY29uc3QgcHJldmlvdXNQYXJhbXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zXG4gICAgY29uc3QgcHJldmlvdXNTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzXG5cbiAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgPSBwYXJhbXNcbiAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlcyA9IHVuZGVmaW5lZFxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZSA9IHByZXZpb3VzT3ZlcnJpZGVcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXMgPSBwcmV2aW91c1BhcmFtc1xuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlcyA9IHByZXZpb3VzU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGNvbnRleHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0LXNjb3BlZCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGV4ZWN1dGVkIGluc2lkZSByZXNvbHZlZCB0ZW5hbnQgYW5kIGFiaWxpdHkgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgd2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChwYXJhbXMsIHJlc3BvbnNlLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHRlbmFudCA9IGNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50UmVzb2x2ZXIoKVxuICAgICAgPyBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHJlcXVlc3QgdGVuYW50IHJlc29sdXRpb25cIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgICAgICAgIHBhcmFtcyxcbiAgICAgICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpLFxuICAgICAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCByZXF1ZXN0XCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFiaWxpdHkgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVBYmlsaXR5KHtcbiAgICAgICAgICBwYXJhbXMsXG4gICAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0KCksXG4gICAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgfSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFByZXZpb3VzIGFiaWxpdHkgb3ZlcnJpZGUuXG4gICAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBjb25zdCBwcmV2aW91c0FiaWxpdHlPdmVycmlkZSA9IHRoaXMuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGVcblxuICAgICAgICB0aGlzLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gYWJpbGl0eVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgICAgICB9KVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSBwcmV2aW91c0FiaWxpdHlPdmVycmlkZVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGFiaWxpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgYWJpbGl0eSBmb3IgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBzY29wZS5cbiAgICovXG4gIGN1cnJlbnRBYmlsaXR5KCkge1xuICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlIHx8IHN1cGVyLmN1cnJlbnRBYmlsaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgZm9yIGNvbnRyb2xsZXIgcmVzb3VyY2UgYWN0aW9ucy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzc0Zyb21Db25maWd1cmF0aW9uKClcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHR5cGVvZiBwYXJhbXMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMubW9kZWwgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHR5cGVvZiBwYXJhbXMuY29udHJvbGxlciA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoZnJvbnRlbmRNb2RlbENsYXNzKSByZXR1cm4gZnJvbnRlbmRNb2RlbENsYXNzXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIGNvbmZpZ3VyZWQgZm9yIG1vZGVsICcke21vZGVsTmFtZSB8fCBcInVua25vd25cIn0nIGFuZCBjb250cm9sbGVyICcke2NvbnRyb2xsZXJOYW1lIHx8IFwidW5rbm93blwifScuIEVuc3VyZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MgZXhpc3RzIGluIHNyYy9yZXNvdXJjZXMvIG9yIGlzIGxpc3RlZCBpbiB0aGUgYWJpbGl0eSByZXNvbHZlci5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbiwgbW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgY3VycmVudCBjb250cm9sbGVyLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHR5cGVvZiBwYXJhbXMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMubW9kZWwgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHR5cGVvZiBwYXJhbXMuY29udHJvbGxlciA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGlmIChtb2RlbE5hbWUgJiYgbW9kZWxOYW1lLmxlbmd0aCA+IDAgJiYgcmVzb3VyY2VzW21vZGVsTmFtZV0pIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsTmFtZV1cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uIHx8ICFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSAnJHttb2RlbE5hbWV9JyBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzc2ApXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgICByZXNvdXJjZUNsYXNzLFxuICAgICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghY29udHJvbGxlck5hbWUgfHwgY29udHJvbGxlck5hbWUubGVuZ3RoIDwgMSkgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCByZXNvdXJjZU1vZGVsTmFtZSBpbiByZXNvdXJjZXMpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW3Jlc291cmNlTW9kZWxOYW1lXVxuICAgICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24gfHwgIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlc291cmNlICcke3Jlc291cmNlTW9kZWxOYW1lfScgbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3NgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VQYXRoID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHJlc291cmNlTW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlTWF0Y2hlc0NvbnRyb2xsZXIoe2NvbnRyb2xsZXJOYW1lLCByZXNvdXJjZVBhdGh9KSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgICAgIG1vZGVsTmFtZTogcmVzb3VyY2VNb2RlbE5hbWUsXG4gICAgICAgICAgICByZXNvdXJjZUNsYXNzLFxuICAgICAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIGJhY2tlbmQgcHJvamVjdCBtb2RlbCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBhcmdzLmJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIE1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7YmFja2VuZFByb2plY3Q6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlLCByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gfCBudWxsfSAtIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIG1vZGVsIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWV9KSB7XG4gICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbE5hbWVdXG5cbiAgICBpZiAoIXJlc291cmNlRGVmaW5pdGlvbikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24gfHwgIXJlc291cmNlQ2xhc3MpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICBtb2RlbE5hbWUsXG4gICAgICByZXNvdXJjZUNsYXNzLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbiwgbW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtcbiAgICAgIGJhY2tlbmRQcm9qZWN0OiBmcm9udGVuZE1vZGVsUmVzb3VyY2UuYmFja2VuZFByb2plY3QsXG4gICAgICBtb2RlbE5hbWU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7e21vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfX0gZnJvbnRlbmRNb2RlbFJlc291cmNlIC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEJhY2tpbmcgcmVjb3JkIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjbGFzcyBmcm9tIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgcmVzb2x2ZWQgZnJvbSBiYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxDbGFzc0Zyb21Db25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGZyb250ZW5kIG1vZGVsIGNsYXNzIGFuZCByZXF1ZXN0ZWQgcHJlbG9hZCB0YXJnZXQgY2xhc3NlcyBhcmUgaW5pdGlhbGl6ZWQuXG4gICAqIFRoaXMgaGFuZGxlcyB0aGUgY2FzZSB3aGVyZSBtb2RlbCBpbml0aWFsaXphdGlvbiB3YXMgc2tpcHBlZCBhdCBzdGFydHVwIChlLmcuLCBicm93c2VyIHRlc3RzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgY2xhc3MgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzc0Zyb21Db25maWd1cmF0aW9uKClcblxuICAgIGlmICghbW9kZWxDbGFzcykgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxSZWNvcmRDbGFzc0luaXRpYWxpemVkKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxQcmVsb2FkQ2xhc3Nlc0luaXRpYWxpemVkKHtcbiAgICAgIGJhY2tlbmRQcm9qZWN0OiBmcm9udGVuZE1vZGVsUmVzb3VyY2UuYmFja2VuZFByb2plY3QsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgcHJlbG9hZDogdGhpcy5mcm9udGVuZE1vZGVsUHJlbG9hZCgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCByZWNvcmQgY2xhc3MgaW5pdGlhbGl6ZWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBtb2RlbCBjbGFzcyBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyb250ZW5kTW9kZWxSZWNvcmRDbGFzc0luaXRpYWxpemVkKG1vZGVsQ2xhc3MpIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MgfHwgbW9kZWxDbGFzcy5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgYXdhaXQgbW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCh7Y29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIHByZWxvYWQgY2xhc3NlcyBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYXJncy5iYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB3aG9zZSBwcmVsb2FkIHRyZWUgaXMgYmVpbmcgcmVzb2x2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbH0gYXJncy5wcmVsb2FkIC0gTm9ybWFsaXplZCBwcmVsb2FkIHRyZWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZCB0YXJnZXQgY2xhc3NlcyBhcmUgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcm9udGVuZE1vZGVsUHJlbG9hZENsYXNzZXNJbml0aWFsaXplZCh7YmFja2VuZFByb2plY3QsIG1vZGVsQ2xhc3MsIHByZWxvYWR9KSB7XG4gICAgaWYgKCFwcmVsb2FkKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFByZWxvYWRdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWQpKSB7XG4gICAgICBpZiAocmVsYXRpb25zaGlwUHJlbG9hZCA9PT0gZmFsc2UpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBwcmVsb2FkIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldENsYXNzSW5pdGlhbGl6ZWQoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgcmVsYXRpb25zaGlwXG4gICAgICB9KVxuXG4gICAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgaWYgKGlzUGxhaW5PYmplY3QocmVsYXRpb25zaGlwUHJlbG9hZCkgJiYgT2JqZWN0LmtleXMocmVsYXRpb25zaGlwUHJlbG9hZCkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGxldCBtZXNzYWdlID0gYENhbm5vdCBwcmVsb2FkIG5lc3RlZCByZWxhdGlvbnNoaXBzIHRocm91Z2ggcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX0gYmVjYXVzZSBpdHMgdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIG5vdCBiZSByZXNvbHZlZGBcblxuICAgICAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSAmJiByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgICAgICBtZXNzYWdlID0gYENhbm5vdCBwcmVsb2FkIG5lc3RlZCByZWxhdGlvbnNoaXBzIHRocm91Z2ggcG9seW1vcnBoaWMgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IobWVzc2FnZSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChyZWxhdGlvbnNoaXBQcmVsb2FkKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUHJlbG9hZENsYXNzZXNJbml0aWFsaXplZCh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICBwcmVsb2FkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi8gKHJlbGF0aW9uc2hpcFByZWxvYWQpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCByZWxhdGlvbnNoaXAgdGFyZ2V0IGNsYXNzIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBhcmdzLmJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLCB3aGVuIGF2YWlsYWJsZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBUYXJnZXRDbGFzc0luaXRpYWxpemVkKHtiYWNrZW5kUHJvamVjdCwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXAudGhyb3VnaCkge1xuICAgICAgY29uc3QgdGhyb3VnaFJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcC5nZXRNb2RlbENsYXNzKCkuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC50aHJvdWdoKVxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwVGFyZ2V0Q2xhc3NJbml0aWFsaXplZCh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICByZWxhdGlvbnNoaXA6IHRocm91Z2hSZWxhdGlvbnNoaXBcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICByZWxhdGlvbnNoaXBcbiAgICB9KVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUmVjb3JkQ2xhc3NJbml0aWFsaXplZCh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGFyZ3MuYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBUYXJnZXQgbW9kZWwgY2xhc3MsIHdoZW4gYXZhaWxhYmxlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3Moe2JhY2tlbmRQcm9qZWN0LCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpICYmIHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT09IFwiYmVsb25nc1RvXCIpIHJldHVybiBudWxsXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmtsYXNzKSByZXR1cm4gcmVsYXRpb25zaGlwLmtsYXNzXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmNsYXNzTmFtZSkge1xuICAgICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgbW9kZWxOYW1lOiByZWxhdGlvbnNoaXAuY2xhc3NOYW1lXG4gICAgICB9KVxuICAgICAgY29uc3QgcmVzb3VyY2VNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlID8gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKGZyb250ZW5kTW9kZWxSZXNvdXJjZSkgOiBudWxsXG5cbiAgICAgIGlmIChyZXNvdXJjZU1vZGVsQ2xhc3MpIHJldHVybiByZXNvdXJjZU1vZGVsQ2xhc3NcblxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE1vZGVsQ2xhc3MgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRNb2RlbENsYXNzZXMoKVtyZWxhdGlvbnNoaXAuY2xhc3NOYW1lXVxuXG4gICAgICBpZiAocmVnaXN0ZXJlZE1vZGVsQ2xhc3MpIHJldHVybiByZWdpc3RlcmVkTW9kZWxDbGFzc1xuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcyB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHJlc291cmNlIHBhdGguXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBtYXRjaGVzIGNvbnRyb2xsZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb250cm9sbGVyTmFtZSAtIENvbnRyb2xsZXIgbmFtZSBmcm9tIHBhcmFtcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBmcm9tIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVzb3VyY2UgcGF0aCBtYXRjaGVzIGN1cnJlbnQgY29udHJvbGxlci5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZU1hdGNoZXNDb250cm9sbGVyKHtjb250cm9sbGVyTmFtZSwgcmVzb3VyY2VQYXRofSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRDb250cm9sbGVyID0gY29udHJvbGxlck5hbWUucmVwbGFjZSgvXlxcLyt8XFwvKyQvZywgXCJcIilcbiAgICBjb25zdCBub3JtYWxpemVkUmVzb3VyY2VQYXRoID0gcmVzb3VyY2VQYXRoLnJlcGxhY2UoL15cXC8rfFxcLyskL2csIFwiXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZFJlc291cmNlUGF0aCA9PT0gbm9ybWFsaXplZENvbnRyb2xsZXIpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFJlc291cmNlUGF0aC5lbmRzV2l0aChgLyR7bm9ybWFsaXplZENvbnRyb2xsZXJ9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IC0gQmFja2VuZCByZXNvdXJjZSBpbnN0YW5jZSBmb3IgY3VycmVudCBmcm9udGVuZC1tb2RlbCBhY3Rpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgY29udHJvbGxlciAnJHt0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5jb250cm9sbGVyfSdgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlQXJncyA9IHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuY3VycmVudEFiaWxpdHkoKSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMsXG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIC4uLih0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldENvbnRleHQoKSB8fCB7fSksXG4gICAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpXG4gICAgICB9LFxuICAgICAgbG9jYWxzOiB0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldExvY2FscygpIHx8IHt9LFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSxcbiAgICAgIG1vZGVsTmFtZTogZnJvbnRlbmRNb2RlbFJlc291cmNlLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNsYXNzKHJlc291cmNlQXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEZyb250ZW5kIG1vZGVsIHByaW1hcnkga2V5LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBhYmlsaXR5IGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFiaWxpdHkgYWN0aW9uIGNvbmZpZ3VyZWQgZm9yIHRoZSBmcm9udGVuZCBhY3Rpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQWJpbGl0eUFjdGlvbihhY3Rpb24pIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgY29udHJvbGxlciAnJHt0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5jb250cm9sbGVyfSdgKVxuICAgIH1cblxuICAgIGNvbnN0IGFiaWxpdGllcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzXG5cbiAgICBpZiAoIWFiaWxpdGllcyB8fCB0eXBlb2YgYWJpbGl0aWVzICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlICcke2Zyb250ZW5kTW9kZWxSZXNvdXJjZS5tb2RlbE5hbWV9JyBtdXN0IGRlZmluZSBhbiAnYWJpbGl0aWVzJyBvYmplY3RgKVxuICAgIH1cblxuICAgIGNvbnN0IGFiaWxpdHlLZXkgPSBhY3Rpb24gPT09IFwiYXR0YWNoXCJcbiAgICAgID8gXCJ1cGRhdGVcIlxuICAgICAgOiAoKGFjdGlvbiA9PT0gXCJkb3dubG9hZFwiIHx8IGFjdGlvbiA9PT0gXCJ1cmxcIiB8fCBhY3Rpb24gPT09IFwiYXR0YWNobWVudExpc3RcIikgPyBcImZpbmRcIiA6IGFjdGlvbilcbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gYWJpbGl0aWVzW2FiaWxpdHlLZXldXG5cbiAgICBpZiAodHlwZW9mIGFiaWxpdHlBY3Rpb24gIT09IFwic3RyaW5nXCIgfHwgYWJpbGl0eUFjdGlvbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc291cmNlICcke2Zyb250ZW5kTW9kZWxSZXNvdXJjZS5tb2RlbE5hbWV9JyBtdXN0IGRlZmluZSBhYmlsaXRpZXMuJHthYmlsaXR5S2V5fWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGFiaWxpdHlBY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGFiaWxpdHkgYXV0aG9yaXplZCBxdWVyeS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBBdXRob3JpemVkIHF1ZXJ5IGZvciB0aGUgYWN0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnkoYWN0aW9uKSB7XG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuZnJvbnRlbmRNb2RlbEFiaWxpdHlBY3Rpb24oYWN0aW9uKVxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCkuYWNjZXNzaWJsZUZvcihhYmlsaXR5QWN0aW9uLCB0aGlzLmN1cnJlbnRBYmlsaXR5KCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBhdXRob3JpemVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQgcXVlcnkgZm9yIHRoZSBhY3Rpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikge1xuICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAocmVzb3VyY2UuYXV0aG9yaXplZFF1ZXJ5ICE9PSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLnByb3RvdHlwZS5hdXRob3JpemVkUXVlcnkpIHtcbiAgICAgIHJldHVybiByZXNvdXJjZS5hdXRob3JpemVkUXVlcnkoYWN0aW9uKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUHJpbWFyeSBrZXkgdmFsdWUgYXMgc3RyaW5nLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlWYWx1ZShtb2RlbCkge1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5KClcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lTWFwID0gbW9kZWwuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBhdHRyaWJ1dGVOYW1lTWFwW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcbiAgICBjb25zdCB2YWx1ZSA9IG1vZGVsLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcblxuICAgIHJldHVybiBTdHJpbmcodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBmaWx0ZXIgYXV0aG9yaXplZCBtb2RlbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3MubW9kZWxzIC0gQ2FuZGlkYXRlIG1vZGVscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBBdXRob3JpemVkIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaWx0ZXJBdXRob3JpemVkTW9kZWxzKHthY3Rpb24sIG1vZGVsc30pIHtcbiAgICBpZiAobW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG1vZGVsc1xuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGlkcyA9IG1vZGVscy5tYXAoKG1vZGVsKSA9PiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpKVxuICAgIGNvbnN0IGF1dGhvcml6ZWRRdWVyeSA9IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShhY3Rpb24pLndoZXJlKHtbcHJpbWFyeUtleV06IGlkc30pXG5cbiAgICBjb25zdCBhdXRob3JpemVkSWRzUmF3ID0gYXdhaXQgYXV0aG9yaXplZFF1ZXJ5LnBsdWNrKHByaW1hcnlLZXkpXG5cbiAgICBjb25zdCBhdXRob3JpemVkSWRzID0gbmV3IFNldChhdXRob3JpemVkSWRzUmF3Lm1hcCgoaWQpID0+IFN0cmluZyhpZCkpKVxuXG4gICAgcmV0dXJuIG1vZGVscy5maWx0ZXIoKG1vZGVsKSA9PiBhdXRob3JpemVkSWRzLmhhcyh0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBmcm9udGVuZCBtb2RlbCBiZWZvcmUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgYWN0aW9uIHNob3VsZCBjb250aW51ZS5cbiAgICovXG4gIGFzeW5jIHJ1bkZyb250ZW5kTW9kZWxCZWZvcmVBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLmJlZm9yZUFjdGlvbihhY3Rpb24pXG5cbiAgICByZXR1cm4gcmVzdWx0ICE9PSBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZmluZCByZWNvcmQuXG4gICAqIEBwYXJhbSB7XCJmaW5kXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBMb2NhdGVkIG1vZGVsIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKGFjdGlvbiwgaWQpIHtcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5maW5kKGFjdGlvbiwgaWQpXG5cbiAgICBpZiAoIW1vZGVsKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgYXV0aG9yaXplZE1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbiwgbW9kZWxzOiBbbW9kZWxdfSlcblxuICAgIHJldHVybiBhdXRob3JpemVkTW9kZWxzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNyZWF0ZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gQ3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW25lc3RlZEF0dHJpYnV0ZXNdIC0gT3B0aW9uYWwgbmVzdGVkLWF0dHJpYnV0ZSBwYXlsb2FkIGZvciBjYXNjYWRpbmcgd3JpdGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IFthdHRhY2htZW50c10gLSBPcHRpb25hbCBhdHRhY2htZW50IHBheWxvYWRzIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIENyZWF0ZWQgbW9kZWwgd2hlbiBhdXRob3JpemVkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbENyZWF0ZVJlY29yZChhdHRyaWJ1dGVzLCBuZXN0ZWRBdHRyaWJ1dGVzID0gbnVsbCwgYXR0YWNobWVudHMgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHJlc291cmNlLmNyZWF0ZShhdHRyaWJ1dGVzLCB7YXR0YWNobWVudHMsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXI6IHRoaXN9KVxuXG4gICAgY29uc3QgYXV0aG9yaXplZE1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbjogXCJjcmVhdGVcIiwgbW9kZWxzOiBbbW9kZWxdfSlcblxuICAgIGlmIChhdXRob3JpemVkTW9kZWxzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhdXRob3JpemVkTW9kZWxzWzBdXG4gICAgfVxuXG4gICAgYXdhaXQgcmVzb3VyY2UuaGFuZGxlVW5hdXRob3JpemVkQ3JlYXRlZE1vZGVsKG1vZGVsKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gRnJvbnRlbmQgbW9kZWwgcmVjb3Jkcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxSZWNvcmRzKCkge1xuICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5yZWNvcmRzKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaWx0ZXJBdXRob3JpemVkTW9kZWxzKHthY3Rpb246IFwiaW5kZXhcIiwgbW9kZWxzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHByZWxvYWQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsfSAtIEZyb250ZW5kIHByZWxvYWQgZGF0YS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmVsb2FkKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUHJlbG9hZCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5wcmVsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHwgbnVsbH0gLSBGcm9udGVuZCBzZWxlY3QgZGF0YS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxTZWxlY3QoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxTZWxlY3QodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuc2VsZWN0LCB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0cyBleHRyYS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB8IG51bGx9IC0gRnJvbnRlbmQgZXh0cmEtc2VsZWN0IGRhdGEgKGRlZmF1bHRzIHBsdXMgdGhlc2UpLCBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYSgpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlbGVjdCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5zZWxlY3RzRXh0cmEsIHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWFyY2hlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gLSBGcm9udGVuZCBzZWFyY2ggZmlsdGVycy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxTZWFyY2hlcygpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlYXJjaGVzKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnNlYXJjaGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgd2hlcmUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIEZyb250ZW5kIHdoZXJlIGZpbHRlcnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsV2hlcmUoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxXaGVyZSh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS53aGVyZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJhbnNhY2suXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIEZyb250ZW5kIFJhbnNhY2sgZmlsdGVycy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSYW5zYWNrKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmFuc2Fjayh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5yYW5zYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgam9pbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIEZyb250ZW5kIGpvaW5zIGRlc2NyaXB0b3JzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEpvaW5zKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsSm9pbnModGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuam9pbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzb3J0LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gLSBGcm9udGVuZCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNvcnQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBub3JtYWxpemVRdWVyeVNvcnQodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuc29ydClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBncm91cC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxHcm91cFtdfSAtIEZyb250ZW5kIGdyb3VwIGRlZmluaXRpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEdyb3VwKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUXVlcnlHcm91cCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5ncm91cClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwYWdpbmF0aW9uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBhZ2luYXRpb259IC0gRnJvbnRlbmQgcGFnaW5hdGlvbiBwYXJhbXMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUGFnaW5hdGlvbigpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtcbiAgICAgIGxpbWl0OiBwYXJhbXMubGltaXQsXG4gICAgICBvZmZzZXQ6IHBhcmFtcy5vZmZzZXQsXG4gICAgICBwYWdlOiBwYXJhbXMucGFnZSxcbiAgICAgIHBlclBhZ2U6IHBhcmFtcy5wZXJQYWdlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGRpc3RpbmN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IG51bGx9IC0gRnJvbnRlbmQgZGlzdGluY3QgZmxhZyB3aGVuIHByb3ZpZGVkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbERpc3RpbmN0KCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsRGlzdGluY3QodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuZGlzdGluY3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwbHVjay5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAtIEZyb250ZW5kIHBsdWNrIGRlZmluaXRpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFBsdWNrKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwbHVjayA9IG5vcm1hbGl6ZVF1ZXJ5UGx1Y2sodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkucGx1Y2spXG5cbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHBsdWNrKVxuXG4gICAgICByZXR1cm4gcGx1Y2tcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb3VudCByZXF1ZXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgYXNrcyBmb3IgYW4gYWdncmVnYXRlIGNvdW50LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbENvdW50UmVxdWVzdGVkKCkge1xuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5jb3VudCA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgd2l0aCBjb3VudC5cbiAgICogQHJldHVybnMge0FycmF5PHthdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn1cbiAgICogICBGcm9udGVuZCB3aXRoQ291bnQgZW50cmllcy4gRW1wdHkgYXJyYXkgd2hlbiBub3QgcmVxdWVzdGVkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS53aXRoQ291bnRcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIEVudHJpZXMuXG4gICAgICogQHR5cGUge0FycmF5PHthdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmF3KSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIikgY29udGludWVcbiAgICAgIGlmICh0eXBlb2YgZW50cnkuYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5hdHRyaWJ1dGVOYW1lLmxlbmd0aCA9PT0gMCkgY29udGludWVcbiAgICAgIGlmICh0eXBlb2YgZW50cnkucmVsYXRpb25zaGlwTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLmxlbmd0aCA9PT0gMCkgY29udGludWVcblxuICAgICAgZW50cmllcy5wdXNoKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogZW50cnkuYXR0cmlidXRlTmFtZSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlICYmIHR5cGVvZiBlbnRyeS53aGVyZSA9PT0gXCJvYmplY3RcIiA/IGVudHJ5LndoZXJlIDogdW5kZWZpbmVkXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZSBhbiBlbnRyeSBmcm9tIHRoZSBmcm9udGVuZC1tb2RlbCBgYWJpbGl0aWVzYCBwYXlsb2FkIHRvXG4gICAqIGl0cyBiYWNrZW5kIG1vZGVsIGNsYXNzIGJ5IGxvb2tpbmcgdXAgdGhlIHJlc291cmNlIGJ5IG1vZGVsTmFtZVxuICAgKiBhY3Jvc3MgYWxsIGNvbmZpZ3VyZWQgYmFja2VuZCBwcm9qZWN0cy4gUmV0dXJucyBudWxsIHdoZW4gbm9cbiAgICogcmVzb3VyY2UgbWF0Y2hlcyB0aGUgdXNlci1wcm92aWRlZCBhYmlsaXR5IGVudHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgbmFtZSBmcm9tIGFuIGFiaWxpdHkgcmVxdWVzdC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBCYWNrZW5kIG1vZGVsIGNsYXNzIGV4cG9zZWQgdW5kZXIgdGhhdCBmcm9udGVuZCBuYW1lLCBpZiBwcmVzZW50LlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDbGFzc0ZvckFiaWxpdGllcyhtb2RlbE5hbWUpIHtcbiAgICBpZiAodHlwZW9mIG1vZGVsTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBtb2RlbE5hbWUubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IGZyb250ZW5kTW9kZWxzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gZnJvbnRlbmRNb2RlbHNbbW9kZWxOYW1lXVxuXG4gICAgICBpZiAoIXJlc291cmNlRGVmaW5pdGlvbikgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgaWYgKCFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgJyR7bW9kZWxOYW1lfScgcmVzb3VyY2UgZGVmaW5pdGlvbiBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENvbGxlY3QgZXZlcnkgbG9hZGVkIHJlY29yZCB3aG9zZSBgZ2V0TW9kZWxOYW1lKClgIG1hdGNoZXMgdGhlXG4gICAqIHJlcXVlc3RlZCBuYW1lLCB3YWxraW5nIGFjcm9zcyB0aGUgcm9vdC1sZXZlbCBzbGljZSBwbHVzIGFueVxuICAgKiBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcyBhdCBhbnkgZGVwdGguIFVzZWQgdG8gZXZhbHVhdGUgcGVyLXJlY29yZFxuICAgKiBhYmlsaXRpZXMgYWdhaW5zdCBuZXN0ZWQgcHJlbG9hZGVkIGNoaWxkcmVuIHdpdGggYSBzaW5nbGUgYmF0Y2hlZFxuICAgKiBxdWVyeSBwZXIgKG1vZGVsQ2xhc3MsIGFjdGlvbikgcGFpci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IHJvb3RNb2RlbHMgLSBMb2FkZWQgcm9vdHMgd2hvc2UgcmVsYXRpb25zaGlwIGdyYXBocyBzaG91bGQgYmUgdHJhdmVyc2VkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgbmFtZSByZWNvcmRzIG11c3QgbWF0Y2guXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IC0gTWF0Y2hpbmcgcmVjb3JkcyByZWFjaGFibGUgZnJvbSB0aGUgbG9hZGVkIHJvb3RzLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDb2xsZWN0UmVjb3Jkc0Zvck5hbWUocm9vdE1vZGVscywgbW9kZWxOYW1lKSB7XG4gICAgLyoqXG4gICAgICogT3V0LlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgY29uc3Qgb3V0ID0gW11cbiAgICAvKipcbiAgICAgKiBTZWVuLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogV2Fsay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsIHwgdW5kZWZpbmVkfSByZWNvcmQgLSBMb2FkZWQgcmVjb3JkIHdob3NlIHJlbGF0aW9uc2hpcCBncmFwaCBzaG91bGQgYmUgdmlzaXRlZC5cbiAgICAgKi9cbiAgICBjb25zdCB3YWxrID0gKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKCFyZWNvcmQgfHwgdHlwZW9mIHJlY29yZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG4gICAgICBpZiAoc2Vlbi5oYXMocmVjb3JkKSkgcmV0dXJuXG4gICAgICBzZWVuLmFkZChyZWNvcmQpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZWNvcmQuZ2V0TW9kZWxDbGFzcygpXG4gICAgICBpZiAoTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSA9PT0gbW9kZWxOYW1lKSB7XG4gICAgICAgIG91dC5wdXNoKHJlY29yZClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwc01hcCA9IE1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhyZWxhdGlvbnNoaXBzTWFwKSkge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGNvbnN0IGxvYWRlZCA9IHJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG4gICAgICAgIGlmIChsb2FkZWQgPT09IHVuZGVmaW5lZCkgY29udGludWVcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBsb2FkZWQpIHdhbGsoY2hpbGQpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgd2Fsayhsb2FkZWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHJvb3Qgb2Ygcm9vdE1vZGVscykgd2Fsayhyb290KVxuXG4gICAgcmV0dXJuIG91dFxuICB9XG5cbiAgLyoqXG4gICAqIEV2YWx1YXRlIGV2ZXJ5IGFiaWxpdHkgcmVxdWVzdGVkIHZpYSB0aGUgZnJvbnRlbmQgYGFiaWxpdGllc2BcbiAgICogcGFyYW0gYWdhaW5zdCB0aGUgbG9hZGVkIG1vZGVsIGNvaG9ydCAocGx1cyBhbnkgcHJlbG9hZGVkXG4gICAqIGNoaWxkcmVuKSwgYXR0YWNoaW5nIHRoZSByZXN1bHRzIHRvIGVhY2ggcmVjb3JkIHZpYVxuICAgKiBgX3NldENvbXB1dGVkQWJpbGl0eWAuIFJ1bnMgb25lIGJhdGNoZWQgYGF1dGhvcml6ZWQgcXVlcnkgKyBwbHVja2BcbiAgICogcGVyIChtb2RlbENsYXNzLCBhY3Rpb24pIHBhaXIsIHJlZ2FyZGxlc3Mgb2YgaG93IG1hbnkgcmVjb3Jkc1xuICAgKiB3ZXJlIGxvYWRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IHJvb3RNb2RlbHMgLSBMb2FkZWQgcm9vdHMgdGhhdCByZWNlaXZlIGNvbXB1dGVkIGFiaWxpdHkgcmVzdWx0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhyb290TW9kZWxzKSB7XG4gICAgY29uc3QgZW50cmllcyA9IHRoaXMuZnJvbnRlbmRNb2RlbEFiaWxpdGllcygpXG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocm9vdE1vZGVscykgfHwgcm9vdE1vZGVscy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eSA9IHRoaXMuY3VycmVudEFiaWxpdHkoKVxuICAgIGlmICghYWJpbGl0eSkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ2xhc3NGb3JBYmlsaXRpZXMoZW50cnkubW9kZWxOYW1lKVxuICAgICAgaWYgKCFtb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbGxlY3RSZWNvcmRzRm9yTmFtZShyb290TW9kZWxzLCBlbnRyeS5tb2RlbE5hbWUpXG4gICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgaWRzID0gY2FuZGlkYXRlc1xuICAgICAgICAubWFwKChyZWNvcmQpID0+IHJlY29yZC5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpKVxuICAgICAgICAuZmlsdGVyKCh2YWx1ZSkgPT4gdmFsdWUgIT09IG51bGwgJiYgdmFsdWUgIT09IHVuZGVmaW5lZClcbiAgICAgIGlmIChpZHMubGVuZ3RoID09PSAwKSBjb250aW51ZVxuXG4gICAgICBmb3IgKGNvbnN0IGFjdGlvbiBvZiBlbnRyeS5hY3Rpb25zKSB7XG4gICAgICAgIGxldCBhbGxvd2VkSWRzXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYXV0aG9yaXplZFF1ZXJ5ID0gbW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKGFjdGlvbiwgYWJpbGl0eSkud2hlcmUoe1twcmltYXJ5S2V5XTogaWRzfSlcbiAgICAgICAgICBjb25zdCBwbHVja2VkID0gYXdhaXQgYXV0aG9yaXplZFF1ZXJ5LnBsdWNrKHByaW1hcnlLZXkpXG4gICAgICAgICAgYWxsb3dlZElkcyA9IG5ldyBTZXQocGx1Y2tlZC5tYXAoKHZhbHVlKSA9PiBTdHJpbmcodmFsdWUpKSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBBbiBhYmlsaXR5IHdpdGggbm8gYWxsb3cgcnVsZXMgZm9yIHRoZSBhY3Rpb24gdGhyb3dzIHZpYVxuICAgICAgICAgIC8vIGBhY2Nlc3NpYmxlRm9yYDsgdHJlYXQgYXMgYSB1bml2ZXJzYWwgZGVueSBzbyB0aGUgZnJvbnRlbmRcbiAgICAgICAgICAvLyBnZXRzIGBjYW4oYWN0aW9uKSA9PT0gZmFsc2VgIGZvciBldmVyeSBjYW5kaWRhdGUsIGluc3RlYWRcbiAgICAgICAgICAvLyBvZiBzdXJmYWNpbmcgYW4gZXJyb3IgdGhhdCB0aGUgVUkgY2FuJ3QgYWN0IG9uLlxuICAgICAgICAgIHZvaWQgZXJyb3JcbiAgICAgICAgICBhbGxvd2VkSWRzID0gbmV3IFNldCgpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgICAgY29uc3QgaWRWYWx1ZSA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXkpXG4gICAgICAgICAgY29uc3QgYWxsb3dlZCA9IGlkVmFsdWUgIT09IG51bGwgJiYgaWRWYWx1ZSAhPT0gdW5kZWZpbmVkICYmIGFsbG93ZWRJZHMuaGFzKFN0cmluZyhpZFZhbHVlKSlcbiAgICAgICAgICByZWNvcmQuX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIGFsbG93ZWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgdGhlIGZyb250ZW5kLW1vZGVsIGBhYmlsaXRpZXNgIHBhcmFtIGludG8gYSBsaXN0IG9mXG4gICAqIGB7bW9kZWxOYW1lLCBhY3Rpb25zfWAgZW50cmllcyB0byBldmFsdWF0ZSBhZ2FpbnN0IGxvYWRlZCByZWNvcmRzLlxuICAgKiBVbmtub3duIGVudHJpZXMgYXJlIHNpbGVudGx5IHNraXBwZWQg4oCUIGRvd25zdHJlYW0gY29kZSByZXNvbHZlc1xuICAgKiBtb2RlbCBuYW1lcyB0byBjbGFzc2VzIHdoZW4gYXBwbHlpbmcgdGhlIGNoZWNrLCBzbyB1bnJlc29sdmVkXG4gICAqIG5hbWVzIG5hdHVyYWxseSBiZWNvbWUgbm8tb3BzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX0+fSAtIE5vcm1hbGl6ZWQgbW9kZWwgYWJpbGl0eSByZXF1ZXN0cy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxBYmlsaXRpZXMoKSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuYWJpbGl0aWVzXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIFtdXG5cbiAgICAvKipcbiAgICAgKiBFbnRyaWVzLlxuICAgICAqIEB0eXBlIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59ICovXG4gICAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJhdykge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIpIGNvbnRpbnVlXG4gICAgICBpZiAodHlwZW9mIGVudHJ5Lm1vZGVsTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5tb2RlbE5hbWUubGVuZ3RoID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGVudHJ5LmFjdGlvbnMpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBhY3Rpb25zID0gZW50cnkuYWN0aW9ucy5maWx0ZXIoXG4gICAgICAgICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBhY3Rpb24pID0+IHR5cGVvZiBhY3Rpb24gPT09IFwic3RyaW5nXCIgJiYgYWN0aW9uLmxlbmd0aCA+IDBcbiAgICAgIClcblxuICAgICAgaWYgKGFjdGlvbnMubGVuZ3RoID09PSAwKSBjb250aW51ZVxuXG4gICAgICBlbnRyaWVzLnB1c2goe2FjdGlvbnMsIG1vZGVsTmFtZTogZW50cnkubW9kZWxOYW1lfSlcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgdGhlIGZyb250ZW5kLW1vZGVsIGBxdWVyeURhdGFgIHBhcmFtLiBUaGUgd2lyZSBmb3JtYXQgY2Fycmllc1xuICAgKiBvbmx5ICoqbmFtZXMqKiAodGhlIGtleXMgdGhlIGZyb250ZW5kIHdhbnRzIGF0dGFjaGVkKSBwbHVzIHRoZVxuICAgKiBvcHRpb25hbCBuZXN0ZWQtcmVsYXRpb25zaGlwIGNoYWluIGxlYWRpbmcgdG8gdGhlbSDigJQgdGhlIGFjdHVhbCBTUUxcbiAgICogZnJhZ21lbnRzIGxpdmUgb24gdGhlIGJhY2tlbmQgbW9kZWwgYXMgYE1vZGVsLnF1ZXJ5RGF0YShuYW1lLCBmbilgXG4gICAqIHJlZ2lzdHJhdGlvbnMuIENhbGxlcnMgY2Fubm90IHB1c2ggU1FMIHRocm91Z2ggdGhpcyBlbmRwb2ludC5cbiAgICpcbiAgICogUmV0dXJucyB0aGUgcmF3IG5lc3RlZC1yZWNvcmQgc3BlYyAoc2hhcGUgdmFsaWRhdGVkIGJ5IHRoZVxuICAgKiBub3JtYWxpemVyIGluc2lkZSBgUXVlcnkucXVlcnlEYXRhYCkgb3IgYG51bGxgIHdoZW4gbm90IHJlcXVlc3RlZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFTcGVjIHwgbnVsbH0gLSBOb3JtYWxpemVkIHF1ZXJ5LWRhdGEgc3BlY2lmaWNhdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxRdWVyeURhdGEoKSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkucXVlcnlEYXRhXG5cbiAgICBpZiAocmF3ID09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHJhd1xuICAgIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiByYXdcbiAgICBpZiAodHlwZW9mIHJhdyA9PT0gXCJvYmplY3RcIikgcmV0dXJuIHJhd1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGluZGV4IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxJbmRleFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gSW5kZXggcXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gLSBGcm9udGVuZCBpbmRleCBxdWVyeSB3aXRoIG5vcm1hbGl6ZWQgcGFyYW1zIGFwcGxpZWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSW5kZXhRdWVyeShvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7aW5jbHVkZVBhZ2luYXRpb24gPSB0cnVlLCBpbmNsdWRlU29ydCA9IHRydWUsIHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpfSA9IG9wdGlvbnNcbiAgICBsZXQgcXVlcnkgPSB0aGlzLmZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoXCJpbmRleFwiKVxuICAgIGNvbnN0IHByZWxvYWQgPSB0aGlzLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcblxuICAgIGlmIChwcmVsb2FkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQocHJlbG9hZClcbiAgICB9XG5cbiAgICBjb25zdCBqb2lucyA9IHRoaXMuZnJvbnRlbmRNb2RlbEpvaW5zKClcbiAgICBjb25zdCB3aGVyZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFdoZXJlKClcbiAgICBjb25zdCBwYWdpbmF0aW9uID0gdGhpcy5mcm9udGVuZE1vZGVsUGFnaW5hdGlvbigpXG4gICAgY29uc3QgZGlzdGluY3QgPSB0aGlzLmZyb250ZW5kTW9kZWxEaXN0aW5jdCgpXG5cbiAgICBpZiAoaW5jbHVkZVBhZ2luYXRpb24pIHtcbiAgICAgIHJlc291cmNlLmFwcGx5RnJvbnRlbmRNb2RlbEluZGV4UGFnaW5hdGlvbih7Y29udHJvbGxlcjogdGhpcywgcGFnaW5hdGlvbiwgcXVlcnl9KVxuICAgIH1cblxuICAgIGlmIChkaXN0aW5jdCAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkuZGlzdGluY3QoZGlzdGluY3QpXG4gICAgfVxuXG4gICAgaWYgKHdoZXJlKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgIH1cblxuICAgIGNvbnN0IHJhbnNhY2sgPSB0aGlzLmZyb250ZW5kTW9kZWxSYW5zYWNrKClcblxuICAgIGlmIChyYW5zYWNrKSB7XG4gICAgICB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrQWxsb3dlZChyYW5zYWNrKVxuICAgICAgcXVlcnkucmFuc2FjayhyYW5zYWNrKVxuICAgIH1cblxuICAgIGlmIChqb2lucykge1xuICAgICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxKb2lucyh7am9pbnMsIHF1ZXJ5fSlcbiAgICB9XG5cbiAgICBjb25zdCBzZWFyY2hlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaGVzKClcblxuICAgIGZvciAoY29uc3Qgc2VhcmNoIG9mIHNlYXJjaGVzKSB7XG4gICAgICByZXNvdXJjZS5hcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlcjogdGhpcywgcXVlcnksIHNlYXJjaH0pXG4gICAgfVxuXG4gICAgY29uc3QgZ3JvdXBzID0gdGhpcy5mcm9udGVuZE1vZGVsR3JvdXAoKVxuXG4gICAgaWYgKGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFJvb3RHcm91cENvbHVtbnMoe3F1ZXJ5fSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxHcm91cCh7Z3JvdXAsIHF1ZXJ5fSlcbiAgICB9XG5cbiAgICBjb25zdCBzb3J0cyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNvcnQoKVxuXG4gICAgaWYgKGluY2x1ZGVTb3J0ICYmIHNvcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3Qgc29ydCBvZiBzb3J0cykge1xuICAgICAgICByZXNvdXJjZS5hcHBseUZyb250ZW5kTW9kZWxJbmRleFNvcnQoe2NvbnRyb2xsZXI6IHRoaXMsIHF1ZXJ5LCBzb3J0fSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB3aXRoQ291bnQgPSB0aGlzLmZyb250ZW5kTW9kZWxXaXRoQ291bnQoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB3aXRoQ291bnQpIHtcbiAgICAgIC8qKlxuICAgICAgICogU3BlYy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICAgIGNvbnN0IHNwZWMgPSB7fVxuICAgICAgc3BlY1tlbnRyeS5hdHRyaWJ1dGVOYW1lXSA9IHtyZWxhdGlvbnNoaXA6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsIHdoZXJlOiBlbnRyeS53aGVyZX1cbiAgICAgIHF1ZXJ5LndpdGhDb3VudChzcGVjKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IHRoaXMuZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpXG5cbiAgICBpZiAocXVlcnlEYXRhICE9IG51bGwpIHtcbiAgICAgIHF1ZXJ5LnF1ZXJ5RGF0YShxdWVyeURhdGEpXG4gICAgfVxuXG4gICAgcXVlcnkgPSB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KVxuXG4gICAgaWYgKHF1ZXJ5Ll9kaXN0aW5jdCAmJiBxdWVyeS5kcml2ZXIuZ2V0VHlwZSgpID09PSBcIm1zc3FsXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxNc3NxbERpc3RpbmN0QnlQcmltYXJ5S2V5UXVlcnkoe3F1ZXJ5fSlcbiAgICB9XG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBNU1NRTCBjYW5ub3QgYXBwbHkgRElTVElOQ1Qgb3ZlciBub24tY29tcGFyYWJsZSB0ZXh0IGNvbHVtbnMgaW4gdGFibGUuKiBzZWxlY3RzLlxuICAgKiBUaGlzIHJld3JpdGVzIGRpc3RpbmN0IGZyb250ZW5kLW1vZGVsIHF1ZXJpZXMgdG8gc2VsZWN0IHJvb3QgcmVjb3JkcyBieSBkaXN0aW5jdCBQSyBzdWJxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IHdpdGggZGlzdGluY3QgYW5kIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IC0gTVNTUUwtc2FmZSBkaXN0aW5jdCBxdWVyeS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxNc3NxbERpc3RpbmN0QnlQcmltYXJ5S2V5UXVlcnkoe3F1ZXJ5fSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3Qgcm9vdFRhYmxlU3FsID0gcXVlcnkuZHJpdmVyLnF1b3RlVGFibGUobW9kZWxDbGFzcy50YWJsZU5hbWUoKSlcbiAgICBjb25zdCBwcmltYXJ5S2V5U3FsID0gYCR7cm9vdFRhYmxlU3FsfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KX1gXG4gICAgY29uc3QgZGlzdGluY3RJZHNRdWVyeSA9IHF1ZXJ5LmNsb25lKClcblxuICAgIGRpc3RpbmN0SWRzUXVlcnkuX3ByZWxvYWQgPSB7fVxuICAgIGRpc3RpbmN0SWRzUXVlcnkuX3NlbGVjdHMgPSBbXVxuICAgIGRpc3RpbmN0SWRzUXVlcnkuc2VsZWN0KHByaW1hcnlLZXlTcWwpXG4gICAgZGlzdGluY3RJZHNRdWVyeS5kaXN0aW5jdCh0cnVlKVxuXG4gICAgY29uc3QgZGlzdGluY3RSb290UXVlcnkgPSBtb2RlbENsYXNzLl9uZXdRdWVyeSgpXG5cbiAgICBkaXN0aW5jdFJvb3RRdWVyeS53aGVyZShgJHtwcmltYXJ5S2V5U3FsfSBJTiAoJHtkaXN0aW5jdElkc1F1ZXJ5LnRvU3FsKCl9KWApXG4gICAgZGlzdGluY3RSb290UXVlcnkuX3ByZWxvYWQgPSB7Li4ucXVlcnkuX3ByZWxvYWR9XG5cbiAgICByZXR1cm4gZGlzdGluY3RSb290UXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBsdWNrIHZhbHVlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQbHVjayBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQbHVja1tdfSBhcmdzLnBsdWNrIC0gUGx1Y2sgZGVzY3JpcHRvcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGx1Y2tlZCB2YWx1ZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsUGx1Y2tWYWx1ZXMoe3F1ZXJ5LCBwbHVja30pIHtcbiAgICBpZiAocGx1Y2subGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1ucyBnaXZlbiB0byBwbHVja1wiKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcGx1Y2tRdWVyeSA9IHF1ZXJ5LmNsb25lKClcbiAgICAvKipcbiAgICAgKiBBbGlhc2VzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBhbGlhc2VzID0gW11cbiAgICBjb25zdCBxdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpXG4gICAgY29uc3QgcGx1Y2tRdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocGx1Y2tRdWVyeSlcbiAgICBjb25zdCBqb2luZWRQYXRocyA9IHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXVxuXG4gICAgcGx1Y2tRdWVyeS5fcHJlbG9hZCA9IHt9XG4gICAgcGx1Y2tRdWVyeS5fc2VsZWN0cyA9IFtdXG4gICAgcGx1Y2tRdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gPSBqb2luZWRQYXRocyA/IG5ldyBTZXQoam9pbmVkUGF0aHMpIDogbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IFtwbHVja0luZGV4LCBwbHVja0VudHJ5XSBvZiBwbHVjay5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgcGF0aDogcGx1Y2tFbnRyeS5wYXRoXG4gICAgICB9KVxuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxRdWVyeWFibGVDb2x1bW5OYW1lKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogcGx1Y2tFbnRyeS5jb2x1bW4sXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IFwicGx1Y2tcIlxuICAgICAgfSlcblxuICAgICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHBsdWNrIGNvbHVtbiBcIiR7cGx1Y2tFbnRyeS5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGlmIChwbHVja0VudHJ5LnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aDogcGx1Y2tFbnRyeS5wYXRoLCBxdWVyeTogcGx1Y2tRdWVyeX0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gcGx1Y2tRdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGx1Y2tFbnRyeS5wYXRoKVxuICAgICAgY29uc3QgY29sdW1uU3FsID0gYCR7cGx1Y2tRdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cGx1Y2tRdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuICAgICAgY29uc3QgYWxpYXMgPSBgZnJvbnRlbmRfbW9kZWxfcGx1Y2tfJHtwbHVja0luZGV4fWBcblxuICAgICAgcGx1Y2tRdWVyeS5zZWxlY3QoYCR7Y29sdW1uU3FsfSBBUyAke3BsdWNrUXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGFsaWFzKX1gKVxuICAgICAgYWxpYXNlcy5wdXNoKGFsaWFzKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBwbHVja1F1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKGFsaWFzZXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBbYWxpYXNdID0gYWxpYXNlc1xuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpW2FsaWFzXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgY29uc3Qgcm93SGFzaCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICByZXR1cm4gYWxpYXNlcy5tYXAoKGFsaWFzKSA9PiByb3dIYXNoW2FsaWFzXSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZnJvbnRlbmQtbW9kZWwgcGx1Y2sgYXR0cmlidXRlIHRvIGEgZGF0YWJhc2UgY29sdW1uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gUmVzb2x2ZWQgREIgY29sdW1uIG5hbWUuXG4gICAqL1xuICByZXNvbHZlRnJvbnRlbmRNb2RlbFBsdWNrQ29sdW1uTmFtZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZXMgJiYgIWF0dHJpYnV0ZU5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBvc2VkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGF0dHJpYnV0ZSBuYW1lcyBmb3IgYSBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz4gfCBudWxsfSBFeHBvc2VkIHJlc291cmNlIGF0dHJpYnV0ZSBuYW1lcywgb3IgbnVsbCB3aGVuIHRoZSByZXNvdXJjZSBleHBvc2VzIGFsbCBEQi1iYWNrZWQgbW9kZWwgYXR0cmlidXRlcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZU5hbWVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVybiBuZXcgU2V0KClcblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXNcblxuICAgIGlmICghYXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVOYW1lcyhhdHRyaWJ1dGVzKVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWVzLnNpemUgPCAxKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBvc2VkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbltcImF0dHJpYnV0ZXNcIl19IGF0dHJpYnV0ZXMgLSBSZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IEV4cG9zZWQgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXMoYXR0cmlidXRlcykge1xuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgYXR0cmlidXRlTmFtZXMuYWRkKGF0dHJpYnV0ZSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUNvbmZpZ3VyYXRpb259ICovIChhdHRyaWJ1dGUpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVDb25maWcubmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBhdHRyaWJ1dGVDb25maWcubmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYXR0cmlidXRlIGFycmF5IGVudHJpZXMgbXVzdCBiZSBzdHJpbmdzIG9yIGNvbmZpZ3Mgd2l0aCBhIG5hbWUuXCIpXG4gICAgICAgIH1cblxuICAgICAgICBhdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlQ29uZmlnLm5hbWUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lc1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydHMgZnJvbnRlbmQtbW9kZWwgcGx1Y2sgZGVmaW5pdGlvbnMgb25seSByZWZlcmVuY2UgZXhwb3NlZCByZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQbHVja1tdfSBwbHVjayAtIFBsdWNrIGRlc2NyaXB0b3JzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxQbHVja0RlZmluaXRpb25zQWxsb3dlZChwbHVjaykge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG5cbiAgICBmb3IgKGNvbnN0IHBsdWNrRW50cnkgb2YgcGx1Y2spIHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgcGF0aDogcGx1Y2tFbnRyeS5wYXRoXG4gICAgICB9KVxuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxQbHVja0NvbHVtbk5hbWUoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBwbHVja0VudHJ5LmNvbHVtbixcbiAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgfSlcblxuICAgICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHBsdWNrIGNvbHVtbiBcIiR7cGx1Y2tFbnRyeS5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydHMgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBkZWZpbml0aW9ucyBvbmx5IHJlZmVyZW5jZSBleHBvc2VkIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByYW5zYWNrIC0gUmFuc2FjayBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrQWxsb3dlZChyYW5zYWNrKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSByYW5zYWNrXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmlsdGVyUGFyYW1zKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrR3JvdXBBbGxvd2VkKHtcbiAgICAgICAgZ3JvdXA6IHRoaXMuZnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cChmaWx0ZXJQYXJhbXMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcyA9PT0gXCJzdHJpbmdcIiAmJiBzLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IHNvcnQgb2YgdGhpcy5mcm9udGVuZE1vZGVsUmFuc2Fja1NvcnRzKHMpKSB7XG4gICAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBdHRyaWJ1dGVBbGxvd2VkKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzb3J0LmF0dHJpYnV0ZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IFwicmFuc2FjayBzb3J0XCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemVkIGZyb250ZW5kLW1vZGVsIFJhbnNhY2sgZ3JvdXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBmaWx0ZXJQYXJhbXMgLSBSYW5zYWNrIGZpbHRlciBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0dyb3VwfSBOb3JtYWxpemVkIFJhbnNhY2sgZ3JvdXAuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmFuc2Fja0dyb3VwKGZpbHRlclBhcmFtcykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUmFuc2Fja0dyb3VwKHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksIGZpbHRlclBhcmFtcylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemVkIGZyb250ZW5kLW1vZGVsIFJhbnNhY2sgc29ydHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzb3J0U3RyaW5nIC0gUmFuc2FjayBzb3J0IHN0cmluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrU29ydFtdfSBOb3JtYWxpemVkIFJhbnNhY2sgc29ydHMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmFuc2Fja1NvcnRzKHNvcnRTdHJpbmcpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHBhcnNlUmFuc2Fja1NvcnQodGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSwgc29ydFN0cmluZylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBhIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBncm91cCBvbmx5IHJlZmVyZW5jZXMgZXhwb3NlZCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFzc2VydGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrR3JvdXB9IGFyZ3MuZ3JvdXAgLSBSYW5zYWNrIGdyb3VwLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrR3JvdXBBbGxvd2VkKHtncm91cH0pIHtcbiAgICBmb3IgKGNvbnN0IGNvbmRpdGlvbiBvZiBncm91cC5jb25kaXRpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBjb25kaXRpb24uYXR0cmlidXRlcykge1xuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSxcbiAgICAgICAgICBwYXRoOiBhdHRyaWJ1dGUucGF0aFxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBdHRyaWJ1dGVBbGxvd2VkKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBhdHRyaWJ1dGUuYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IFwicmFuc2Fja1wiXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBncm91cGluZyBvZiBncm91cC5ncm91cGluZ3MpIHtcbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cEFsbG93ZWQoe2dyb3VwOiBncm91cGluZ30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydHMgb25lIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBhdHRyaWJ1dGUgaXMgZXhwb3NlZCBieSBpdHMgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzZXJ0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5vcGVyYXRpb25OYW1lIC0gT3BlcmF0aW9uIG5hbWUgZm9yIGVycm9ycy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0F0dHJpYnV0ZUFsbG93ZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbk5hbWV9KSB7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZU5hbWVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWVzICYmICFhdHRyaWJ1dGVOYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duICR7b3BlcmF0aW9uTmFtZX0gYXR0cmlidXRlIFwiJHthdHRyaWJ1dGVOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHNlYXJjaCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIFJvb3QgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe21vZGVsQ2xhc3MsIHBhdGh9KSB7XG4gICAgbGV0IHRhcmdldE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcGF0aCkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gc2VhcmNoIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzXG4gICAgfVxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHNlYXJjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBmaWx0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIHBhdGg6IHNlYXJjaC5wYXRoXG4gICAgfSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgYXR0cmlidXRlTmFtZTogc2VhcmNoLmNvbHVtbixcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBvcGVyYXRpb25OYW1lOiBcInNlYXJjaFwiXG4gICAgfSlcblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gc2VhcmNoIGNvbHVtbiBcIiR7c2VhcmNoLmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoLnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGg6IHNlYXJjaC5wYXRoLCBxdWVyeX0pXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4uc2VhcmNoLnBhdGgpXG4gICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG4gICAgY29uc3Qgb3BlcmF0b3JNYXAgPSB7XG4gICAgICBlcTogXCI9XCIsXG4gICAgICBndDogXCI+XCIsXG4gICAgICBndGVxOiBcIj49XCIsXG4gICAgICBsaWtlOiBcIkxJS0VcIixcbiAgICAgIGx0OiBcIjxcIixcbiAgICAgIGx0ZXE6IFwiPD1cIixcbiAgICAgIG5vdEVxOiBcIiE9XCJcbiAgICB9XG4gICAgY29uc3Qgc3FsT3BlcmF0b3IgPSBvcGVyYXRvck1hcFtzZWFyY2gub3BlcmF0b3JdXG5cbiAgICBpZiAoc2VhcmNoLm9wZXJhdG9yID09PSBcImVxXCIpIHtcbiAgICAgIGlmICh0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEFycmF5U2VhcmNoKHtlbXB0eVNxbDogXCIxPTBcIiwgb3BlcmF0b3JTcWw6IFwiSU5cIiwgcXVlcnksIHNlYXJjaCwgY29sdW1uU3FsfSkpIHJldHVyblxuXG4gICAgICBpZiAoc2VhcmNoLnZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gSVMgTlVMTGApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzZWFyY2gub3BlcmF0b3IgPT09IFwibm90RXFcIikge1xuICAgICAgaWYgKHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsQXJyYXlTZWFyY2goe2VtcHR5U3FsOiBcIjE9MVwiLCBvcGVyYXRvclNxbDogXCJOT1QgSU5cIiwgcXVlcnksIHNlYXJjaCwgY29sdW1uU3FsfSkpIHJldHVyblxuXG4gICAgICBpZiAoc2VhcmNoLnZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gSVMgTk9UIE5VTExgKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9ICR7c3FsT3BlcmF0b3J9ICR7cXVlcnkuZHJpdmVyLnF1b3RlKHNlYXJjaC52YWx1ZSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBseSBhcnJheS12YWx1ZWQgZXF1YWxpdHkgc2VhcmNoIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uU3FsIC0gU1FMIGZvciB0aGUgc2VhcmNoZWQgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5lbXB0eVNxbCAtIFNRTCBwcmVkaWNhdGUgdXNlZCB3aGVuIHRoZSBhcnJheSBpcyBlbXB0eS5cbiAgICogQHBhcmFtIHtcIklOXCIgfCBcIk5PVCBJTlwifSBhcmdzLm9wZXJhdG9yU3FsIC0gU1FMIGFycmF5IG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW4gYXJyYXkgcHJlZGljYXRlIHdhcyBhcHBsaWVkLlxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsQXJyYXlTZWFyY2goe2NvbHVtblNxbCwgZW1wdHlTcWwsIG9wZXJhdG9yU3FsLCBxdWVyeSwgc2VhcmNofSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShzZWFyY2gudmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChzZWFyY2gudmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICBxdWVyeS53aGVyZShlbXB0eVNxbClcbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSAke29wZXJhdG9yU3FsfSAoJHtzZWFyY2gudmFsdWUubWFwKChlbnRyeSkgPT4gcXVlcnkuZHJpdmVyLnF1b3RlKGVudHJ5KSkuam9pbihcIiwgXCIpfSlgKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCBwYWdpbmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUGFnaW5hdGlvbn0gYXJncy5wYWdpbmF0aW9uIC0gUGFnaW5hdGlvbiB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbih7cXVlcnksIHBhZ2luYXRpb259KSB7XG4gICAgaWYgKHBhZ2luYXRpb24ubGltaXQgIT09IG51bGwpIHtcbiAgICAgIHF1ZXJ5LmxpbWl0KHBhZ2luYXRpb24ubGltaXQpXG4gICAgfVxuXG4gICAgaWYgKHBhZ2luYXRpb24ub2Zmc2V0ICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5vZmZzZXQocGFnaW5hdGlvbi5vZmZzZXQpXG4gICAgfVxuXG4gICAgaWYgKHBhZ2luYXRpb24ucGVyUGFnZSAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkucGVyUGFnZShwYWdpbmF0aW9uLnBlclBhZ2UpXG4gICAgfVxuXG4gICAgaWYgKHBhZ2luYXRpb24ucGFnZSAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkucGFnZShwYWdpbmF0aW9uLnBhZ2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgd2hlcmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2hlcmUgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mud2hlcmUgLSBSb290LW1vZGVsIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pIHtcbiAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlRm9yUGF0aCh7XG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgcGF0aDogW10sXG4gICAgICBxdWVyeSxcbiAgICAgIHdoZXJlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIGpvaW5zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW5zIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmpvaW5zIC0gUmVsYXRpb25zaGlwLW9iamVjdCBqb2lucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxKb2lucyh7am9pbnMsIHF1ZXJ5fSkge1xuICAgIGNvbnN0IGpvaW5QYXRoS2V5cyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxKb2luc0ZvclBhdGgoe1xuICAgICAgam9pbnMsXG4gICAgICBqb2luUGF0aEtleXMsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgcGF0aDogW10sXG4gICAgICBxdWVyeVxuICAgIH0pXG5cbiAgICBxdWVyeS5qb2lucyhqb2lucylcblxuICAgIGNvbnN0IHF1ZXJ5TWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShxdWVyeSlcbiAgICBjb25zdCBqb2luZWRQYXRocyA9IHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXSB8fCBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3Qgam9pblBhdGhLZXkgb2Ygam9pblBhdGhLZXlzKSB7XG4gICAgICBqb2luZWRQYXRocy5hZGQoam9pblBhdGhLZXkpXG4gICAgfVxuXG4gICAgcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdID0gam9pbmVkUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIGpvaW5zIGZvciBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW5zIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmpvaW5zIC0gSm9pbnMgZm9yIGN1cnJlbnQgcGF0aC5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gYXJncy5qb2luUGF0aEtleXMgLSBKb2luZWQgcGF0aCBrZXlzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBmb3IgY3VycmVudCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxKb2luc0ZvclBhdGgoe2pvaW5zLCBqb2luUGF0aEtleXMsIG1vZGVsQ2xhc3MsIHBhdGgsIHF1ZXJ5fSkge1xuICAgIHZvaWQgcXVlcnlcblxuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcEpvaW5dIG9mIE9iamVjdC5lbnRyaWVzKGpvaW5zKSkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gam9pbiByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBmb3Igam9pbiByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgb24gJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwUGF0aCA9IFsuLi5wYXRoLCByZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgam9pblBhdGhLZXlzLmFkZChyZWxhdGlvbnNoaXBQYXRoLmpvaW4oXCIuXCIpKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwSm9pbiA9PT0gdHJ1ZSkgY29udGludWVcblxuICAgICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxKb2luc0ZvclBhdGgoe1xuICAgICAgICBqb2luczogcmVsYXRpb25zaGlwSm9pbixcbiAgICAgICAgam9pblBhdGhLZXlzLFxuICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICBwYXRoOiByZWxhdGlvbnNoaXBQYXRoLFxuICAgICAgICBxdWVyeVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBleHBvc2VkIGF0dHJpYnV0ZSBuYW1lcyBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+IHwgbnVsbH0gLSBFeHBvc2VkIGF0dHJpYnV0ZSBuYW1lcywgb3IgbnVsbCB3aGVuIG5vIHJlc291cmNlIG1ldGFkYXRhIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxFeHBvc2VkQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZT8ucmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXNcblxuICAgIGlmICghYXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IGF0dHJpYnV0ZXNcbiAgICAgICAgLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSByZXR1cm4gZW50cnlcbiAgICAgICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGxcblxuICAgICAgICAgIGNvbnN0IG5hbWUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KS5uYW1lXG5cbiAgICAgICAgICByZXR1cm4gdHlwZW9mIG5hbWUgPT09IFwic3RyaW5nXCIgJiYgbmFtZS5sZW5ndGggPiAwID8gbmFtZSA6IG51bGxcbiAgICAgICAgfSlcbiAgICAgICAgLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIilcblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIG5ldyBTZXQoYXR0cmlidXRlTmFtZXMpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZnJvbnRlbmQtc3VwcGxpZWQga2V5IHRvIGl0cyBjYW5vbmljYWwgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEZyb250ZW5kIGtleSBvciByYXcgY29sdW1uIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVGb3JLZXkobW9kZWxDbGFzcywga2V5KSB7XG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShrZXkpXG5cbiAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXG5cbiAgICBjb25zdCBjb2x1bW5BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClba2V5XVxuXG4gICAgcmV0dXJuIGNvbHVtbkF0dHJpYnV0ZU5hbWUgfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIGZyb250ZW5kLXN1cHBsaWVkIGF0dHJpYnV0ZSBpcyBleHBvc2VkIGJ5IHRoZSByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gUmVxdWVzdGVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVzb3VyY2UgcGVybWl0cyB0aGUgYXR0cmlidXRlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUlzRXhwb3NlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBleHBvc2VkQXR0cmlidXRlTmFtZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxFeHBvc2VkQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWV4cG9zZWRBdHRyaWJ1dGVOYW1lcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBleHBvc2VkQXR0cmlidXRlTmFtZXMuaGFzKGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBhIHNlbGVjdGVkIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBsaXN0IG9ubHkgcmVmZXJlbmNlcyBleHBvc2VkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5hdHRyaWJ1dGVOYW1lcyAtIFNlbGVjdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7XCJzZWxlY3RcIiB8IFwic2VsZWN0c0V4dHJhXCJ9IGFyZ3Mub3BlcmF0aW9uTmFtZSAtIFNlbGVjdGlvbiBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBBbGxvd2VkIHNlbGVjdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNBbGxvd2VkKHthdHRyaWJ1dGVOYW1lcywgbW9kZWxDbGFzcywgb3BlcmF0aW9uTmFtZX0pIHtcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgIGlmICh0aGlzLmZyb250ZW5kTW9kZWxBdHRyaWJ1dGVJc0V4cG9zZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSkgY29udGludWVcblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gJHtvcGVyYXRpb25OYW1lfSBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSB1c2VyLXF1ZXJ5YWJsZSBmcm9udGVuZCBhdHRyaWJ1dGUgdG8gYSBkYXRhYmFzZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIFJlcXVlc3RlZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7XCJncm91cFwiIHwgXCJwbHVja1wiIHwgXCJzZWFyY2hcIiB8IFwic29ydFwiIHwgXCJ3aGVyZVwifSBhcmdzLm9wZXJhdGlvbk5hbWUgLSBRdWVyeSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVzb2x2ZWQgY29sdW1uIG5hbWUuXG4gICAqL1xuICByZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbk5hbWV9KSB7XG4gICAgdm9pZCBvcGVyYXRpb25OYW1lXG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSB0aGlzLmZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lRm9yS2V5KG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lICYmICF0aGlzLmZyb250ZW5kTW9kZWxBdHRyaWJ1dGVJc0V4cG9zZWQoe2F0dHJpYnV0ZU5hbWU6IHJlc29sdmVkQXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBrZXkgdGhhdCBtYXkgYmUgZWl0aGVyIGEgY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lIG9yIGEgcmF3IERCXG4gICAqIGNvbHVtbiBuYW1lIHRvIGl0cyBjYW5vbmljYWwgY29sdW1uIG5hbWUuICBSZXR1cm5zIGB1bmRlZmluZWRgIHdoZW4gdGhlXG4gICAqIGtleSBtYXRjaGVzIG5laXRoZXIgbWFwLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBBdHRyaWJ1dGUgbmFtZSBvciBjb2x1bW4gbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFJlc29sdmVkIERCIGNvbHVtbiBuYW1lLCBvciBgdW5kZWZpbmVkYC5cbiAgICovXG4gIHJlc29sdmVGcm9udGVuZE1vZGVsQ29sdW1uTmFtZShtb2RlbENsYXNzLCBrZXkpIHtcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGtleSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG5cbiAgICAvLyBGYWxsIGJhY2s6IHRoZSBrZXkgbWF5IGFscmVhZHkgYmUgYSByYXcgREIgY29sdW1uIG5hbWUgbm90IHByZXNlbnQgaW4gdGhlIGF0dHJpYnV0ZSBtYXAuXG4gICAgaWYgKG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2tleV0pIHJldHVybiBrZXlcblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHdoZXJlIGZvciBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdoZXJlIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGZvciBjdXJyZW50IHdoZXJlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLndoZXJlIC0gV2hlcmUgY29uZGl0aW9ucyBmb3IgY3VycmVudCBzY29wZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxXaGVyZUZvclBhdGgoe21vZGVsQ2xhc3MsIHBhdGgsIHF1ZXJ5LCB3aGVyZX0pIHtcbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMod2hlcmUpKSB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb25OYW1lOiBcIndoZXJlXCJcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoLCBxdWVyeX0pXG5cbiAgICAgICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aClcbiAgICAgICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgaWYgKHZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcXVlcnkud2hlcmUoXCIxPTBcIilcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlcyA9IHZhbHVlLm1hcCgoZW50cnkpID0+IHRoaXMubm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlQ29sdW1uVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlOiBlbnRyeX0pKVxuXG4gICAgICAgICAgICBpZiAobm9ybWFsaXplZFZhbHVlcy5pbmNsdWRlcyhmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sKSkge1xuICAgICAgICAgICAgICBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSBJTiAoJHtub3JtYWxpemVkVmFsdWVzLm1hcCgoZW50cnkpID0+IHF1ZXJ5LmRyaXZlci5xdW90ZShlbnRyeSkpLmpvaW4oXCIsIFwiKX0pYClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgICAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9IElTIE5VTExgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMubm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlQ29sdW1uVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlfSlcblxuICAgICAgICAgIGlmIChub3JtYWxpemVkVmFsdWUgPT09IGZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hTeW1ib2wpIHtcbiAgICAgICAgICAgIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gPSAke3F1ZXJ5LmRyaXZlci5xdW90ZShub3JtYWxpemVkVmFsdWUpfWApXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biB3aGVyZSByZWxhdGlvbnNoaXAgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciB3aGVyZSByZWxhdGlvbnNoaXAgXCIke2F0dHJpYnV0ZU5hbWV9XCIgb24gJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcFBhdGggPSBbLi4ucGF0aCwgYXR0cmlidXRlTmFtZV1cblxuICAgICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlRm9yUGF0aCh7XG4gICAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgICAgICBwYXRoOiByZWxhdGlvbnNoaXBQYXRoLFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHdoZXJlOiB2YWx1ZVxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHdoZXJlIGNvbHVtbiBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgd2hlcmUgY29sdW1uIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBXaGVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgc3ltYm9sfSAtIFNRTC1zYWZlIHdoZXJlIHZhbHVlLlxuICAgKi9cbiAgbm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlQ29sdW1uVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlfSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSk/LnRvTG93ZXJDYXNlKClcbiAgICAgIGNvbnN0IGlzRGF0ZVRpbWVDb2x1bW4gPSB0eXBlb2YgY29sdW1uVHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBbXCJkYXRlXCIsIFwiZGF0ZXRpbWVcIiwgXCJ0aW1lc3RhbXBcIl0uc29tZSgodHlwZSkgPT4gY29sdW1uVHlwZS5pbmNsdWRlcyh0eXBlKSlcblxuICAgICAgaWYgKGlzRGF0ZVRpbWVDb2x1bW4pIHtcbiAgICAgICAgY29uc3QgcGFyc2VkRGF0ZSA9IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSl9KVxuXG4gICAgICAgIGlmIChpc0RhdGUocGFyc2VkRGF0ZSkpIHtcbiAgICAgICAgICByZXR1cm4gcGFyc2VkRGF0ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgY29sdW1uVHlwZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbFxuICAgICAgfVxuXG4gICAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKVxuICAgICAgY29uc3Qgb2JqZWN0VmFsdWVUeXBlcyA9IG5ldyBTZXQoW1wiY2hhclwiLCBcInZhcmNoYXJcIiwgXCJudmFyY2hhclwiLCBcInN0cmluZ1wiLCBcImVudW1cIiwgXCJqc29uXCIsIFwianNvbmJcIiwgXCJjaXRleHRcIiwgXCJiaW5hcnlcIiwgXCJ2YXJiaW5hcnlcIl0pXG4gICAgICBjb25zdCBzdXBwb3J0c09iamVjdFZhbHVlcyA9IG5vcm1hbGl6ZWRUeXBlLmluY2x1ZGVzKFwidGV4dFwiKSB8fCBvYmplY3RWYWx1ZVR5cGVzLmhhcyhub3JtYWxpemVkVHlwZSlcblxuICAgICAgaWYgKCFzdXBwb3J0c09iamVjdFZhbHVlcykge1xuICAgICAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCBncm91cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBHcm91cCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxHcm91cH0gYXJncy5ncm91cCAtIEdyb3VwIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsR3JvdXAoe3F1ZXJ5LCBncm91cH0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBwYXRoOiBncm91cC5wYXRoXG4gICAgfSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgYXR0cmlidXRlTmFtZTogZ3JvdXAuY29sdW1uLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwiZ3JvdXBcIlxuICAgIH0pXG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIGdyb3VwIGNvbHVtbiBcIiR7Z3JvdXAuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoOiBncm91cC5wYXRoLCBxdWVyeX0pXG5cbiAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5ncm91cC5wYXRoKVxuICAgIGNvbnN0IGNvbHVtblNxbCA9IGAke3F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHRhYmxlUmVmZXJlbmNlKX0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuXG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsR3JvdXBDb2x1bW4oe2NvbHVtblNxbCwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgcm9vdC1tb2RlbCBjb2x1bW5zIHRvIEdST1VQIEJZIHNvIHN0cmljdCBTUUwgZW5naW5lcyBhY2NlcHQgZGVmYXVsdCByb290LXRhYmxlIHNlbGVjdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxSb290R3JvdXBDb2x1bW5zKHtxdWVyeX0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHJvb3RUYWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgT2JqZWN0LnZhbHVlcyhhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSkge1xuICAgICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUocm9vdFRhYmxlUmVmZXJlbmNlKX0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuXG4gICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxHcm91cENvbHVtbih7Y29sdW1uU3FsLCBxdWVyeX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYSBncm91cC1ieSBTUUwgY29sdW1uIGlzIG9ubHkgYXBwZW5kZWQgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5TcWwgLSBGdWxseS1xdWFsaWZpZWQgY29sdW1uIFNRTC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnN1cmVGcm9udGVuZE1vZGVsR3JvdXBDb2x1bW4oe2NvbHVtblNxbCwgcXVlcnl9KSB7XG4gICAgY29uc3QgcXVlcnlNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KVxuICAgIGNvbnN0IGdyb3VwZWRDb2x1bW5zID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsR3JvdXBlZENvbHVtbnNTeW1ib2xdIHx8IG5ldyBTZXQoKVxuXG4gICAgaWYgKGdyb3VwZWRDb2x1bW5zLmhhcyhjb2x1bW5TcWwpKSByZXR1cm5cblxuICAgIHF1ZXJ5Lmdyb3VwKGNvbHVtblNxbClcbiAgICBncm91cGVkQ29sdW1ucy5hZGQoY29sdW1uU3FsKVxuICAgIHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEdyb3VwZWRDb2x1bW5zU3ltYm9sXSA9IGdyb3VwZWRDb2x1bW5zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCB0cmFuc2xhdGVkIGF0dHJpYnV0ZSBwcmVsb2Fkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gUXVlcnkgd2l0aCB0cmFuc2xhdGlvbnMgcHJlbG9hZGVkIGlmIG5lZWRlZC5cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxFZmZlY3RpdmVTZWxlY3RlZEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIHRoaXMuZnJvbnRlbmRNb2RlbERlZmF1bHRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB8fCBbXSlcbiAgICAgIHx8IHRoaXMuZnJvbnRlbmRNb2RlbERlZmF1bHRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFzZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiBxdWVyeVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcbiAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldChyZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW10pXG4gICAgbGV0IG5lZWRzVHJhbnNsYXRpb25zID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGNvbnN0IGhvb2tOYW1lID0gYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVTZWxlY3RlZGBcbiAgICAgIGNvbnN0IGR5bmFtaWNSZXNvdXJjZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlc291cmNlKSlcblxuICAgICAgaWYgKHR5cGVvZiBkeW5hbWljUmVzb3VyY2VbaG9va05hbWVdID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZHluYW1pY1Jlc291cmNlW2hvb2tOYW1lXSh7cXVlcnl9KVxuXG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICBxdWVyeSA9IHJlc3VsdFxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIG5lZWRzVHJhbnNsYXRpb25zID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChuZWVkc1RyYW5zbGF0aW9ucykge1xuICAgICAgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHt0cmFuc2xhdGlvbnM6IHt9fSlcbiAgICB9XG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHNvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU29ydCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTb3J0fSBhcmdzLnNvcnQgLSBTb3J0IGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsU29ydCh7cXVlcnksIHNvcnR9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgcGF0aDogc29ydC5wYXRoXG4gICAgfSlcbiAgICBjb25zdCB0cmFuc2xhdGVkQXR0cmlidXRlc01hcCA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0VHJhbnNsYXRpb25zTWFwKClcbiAgICBjb25zdCB0cmFuc2xhdGVkQXR0cmlidXRlTmFtZXMgPSBPYmplY3Qua2V5cyh0cmFuc2xhdGVkQXR0cmlidXRlc01hcClcbiAgICBjb25zdCBpc1RyYW5zbGF0ZWRTb3J0QXR0cmlidXRlID0gdHJhbnNsYXRlZEF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKHNvcnQuY29sdW1uKVxuXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxRdWVyeWFibGVDb2x1bW5OYW1lKHtcbiAgICAgIGF0dHJpYnV0ZU5hbWU6IHNvcnQuY29sdW1uLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwic29ydFwiXG4gICAgfSlcbiAgICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0LmRpcmVjdGlvbi50b1VwcGVyQ2FzZSgpXG5cbiAgICBpZiAoaXNUcmFuc2xhdGVkU29ydEF0dHJpYnV0ZSkge1xuICAgICAgY29uc3QgdHJhbnNsYXRpb25Nb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbkNsYXNzKClcbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCA9IHRyYW5zbGF0aW9uTW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQ29sdW1uTmFtZSA9IHRyYW5zbGF0aW9uQXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcFtzb3J0LmNvbHVtbl1cbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uUGF0aCA9IHNvcnQucGF0aC5jb25jYXQoW1wiY3VycmVudFRyYW5zbGF0aW9uXCJdKVxuXG4gICAgICBpZiAoIXRyYW5zbGF0aW9uQ29sdW1uTmFtZSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biB0cmFuc2xhdGVkIHNvcnQgY29sdW1uIFwiJHtzb3J0LmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsU29ydEpvaW5QYXRoKHtwYXRoOiB0cmFuc2xhdGlvblBhdGgsIHF1ZXJ5fSlcblxuICAgICAgY29uc3QgdHJhbnNsYXRpb25UYWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi50cmFuc2xhdGlvblBhdGgpXG4gICAgICBjb25zdCB0cmFuc2xhdGlvbkNvbHVtblNxbCA9IGAke3F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHRyYW5zbGF0aW9uVGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbih0cmFuc2xhdGlvbkNvbHVtbk5hbWUpfWBcblxuICAgICAgcXVlcnkub3JkZXIoYCR7dHJhbnNsYXRpb25Db2x1bW5TcWx9ICR7ZGlyZWN0aW9ufWApXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gc29ydCBjb2x1bW4gXCIke3NvcnQuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFNvcnRKb2luUGF0aCh7cGF0aDogc29ydC5wYXRoLCBxdWVyeX0pXG5cbiAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5zb3J0LnBhdGgpXG4gICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICBxdWVyeS5vcmRlcihgJHtjb2x1bW5TcWx9ICR7ZGlyZWN0aW9ufWApXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIHNvcnQgam9pbiBwYXRoIGhhcyBiZWVuIGpvaW5lZCBvbiBxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBKb2luIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZW5zdXJlRnJvbnRlbmRNb2RlbFNvcnRKb2luUGF0aCh7cGF0aCwgcXVlcnl9KSB7XG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGgsIHF1ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGEgcmVsYXRpb25zaGlwIHBhdGggaGFzIGV4YWN0bHkgb25lIFNRTCBqb2luLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW4gYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGgsIHF1ZXJ5fSkge1xuICAgIGlmIChwYXRoLmxlbmd0aCA8IDEpIHJldHVyblxuXG4gICAgY29uc3QgcXVlcnlNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KVxuICAgIGNvbnN0IGpvaW5lZFBhdGhzID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdIHx8IG5ldyBTZXQoKVxuICAgIGNvbnN0IHBhdGhLZXkgPSBwYXRoLmpvaW4oXCIuXCIpXG5cbiAgICBpZiAoam9pbmVkUGF0aHMuaGFzKHBhdGhLZXkpKSByZXR1cm5cblxuICAgIHF1ZXJ5LmpvaW5zKGJ1aWxkRnJvbnRlbmRNb2RlbEpvaW5PYmplY3RGcm9tUGF0aChwYXRoKSlcbiAgICBqb2luZWRQYXRocy5hZGQocGF0aEtleSlcbiAgICBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gPSBqb2luZWRQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0ZWQgYXR0cmlidXRlcyBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBTZWxlY3RlZCBhdHRyaWJ1dGVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBzZWxlY3QgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWxlY3QoKVxuXG4gICAgaWYgKCFzZWxlY3QpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBzZWxlY3RbbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKV0gfHwgbnVsbFxuXG4gICAgaWYgKCFzZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsU2VsZWN0ZWRBdHRyaWJ1dGVzQWxsb3dlZCh7XG4gICAgICBhdHRyaWJ1dGVOYW1lczogc2VsZWN0ZWRBdHRyaWJ1dGVzLFxuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwic2VsZWN0XCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0cyBleHRyYSBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBFeHRyYSBhdHRyaWJ1dGVzIChsb2FkZWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzKSBmb3IgdGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYUZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IHNlbGVjdHNFeHRyYSA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYSgpXG5cbiAgICBpZiAoIXNlbGVjdHNFeHRyYSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGV4dHJhQXR0cmlidXRlcyA9IHNlbGVjdHNFeHRyYVttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSB8fCBudWxsXG5cbiAgICBpZiAoIWV4dHJhQXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNBbGxvd2VkKHtcbiAgICAgIGF0dHJpYnV0ZU5hbWVzOiBleHRyYUF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJzZWxlY3RzRXh0cmFcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGZpbmFsIHNldCBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gc2VyaWFsaXplIGZvciBhIG1vZGVsIGNsYXNzOlxuICAgKiBhbiBleHBsaWNpdCBuYXJyb3dpbmcgYHNlbGVjdGAgd2luczsgb3RoZXJ3aXNlLCB3aGVuIGBzZWxlY3RzRXh0cmFgIGlzIGdpdmVuLFxuICAgKiB0aGUgZGVmYXVsdCBhdHRyaWJ1dGVzIHBsdXMgdGhlIGV4dHJhczsgb3RoZXJ3aXNlIG51bGwgKGRlZmF1bHQgYmVoYXZpb3IpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGZhbGxiYWNrQXR0cmlidXRlTmFtZXMgLSBBdHRyaWJ1dGUgbmFtZXMgdG8gdHJlYXQgYXMgdGhlIGRlZmF1bHRzIHdoZW4gdGhlIHJlc291cmNlIGRlY2xhcmVzIG5vbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IC0gRWZmZWN0aXZlIHNlbGVjdGVkIGF0dHJpYnV0ZSBuYW1lcywgb3IgbnVsbCBmb3IgZGVmYXVsdCBzZXJpYWxpemF0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEVmZmVjdGl2ZVNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcywgZmFsbGJhY2tBdHRyaWJ1dGVOYW1lcykge1xuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmIChzZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiBzZWxlY3RlZEF0dHJpYnV0ZXNcblxuICAgIGNvbnN0IGV4dHJhQXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYUZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmICghZXh0cmFBdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZGVmYXVsdEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxEZWZhdWx0QXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykgfHwgZmFsbGJhY2tBdHRyaWJ1dGVOYW1lc1xuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldChbLi4uZGVmYXVsdEF0dHJpYnV0ZXMsIC4uLmV4dHJhQXR0cmlidXRlc10pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZGVmYXVsdCBhdHRyaWJ1dGVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIERlZmF1bHQgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcyBkZWNsYXJlZCBvbiB0aGUgcmVzb3VyY2UuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZT8ucmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXNcblxuICAgIGlmICghYXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgICBjb25zdCBjb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KVxuXG4gICAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcuc2VsZWN0ZWRCeURlZmF1bHQgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcblxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0pXG4gICAgICAgIC5tYXAoKGVudHJ5KSA9PiB0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIgPyBlbnRyeSA6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpLm5hbWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcylcbiAgICAgICAgLmZpbHRlcigoWywgY29uZmlnXSkgPT4ge1xuICAgICAgICAgIGlmICghY29uZmlnIHx8IHR5cGVvZiBjb25maWcgIT09IFwib2JqZWN0XCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjb25maWcpLnNlbGVjdGVkQnlEZWZhdWx0ICE9PSBmYWxzZVxuICAgICAgICB9KVxuICAgICAgICAubWFwKChbbmFtZV0pID0+IG5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6ZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2VyaWFsaXplZCBhdHRyaWJ1dGVzIGZpbHRlcmVkIGJ5IHNlbGVjdCBtYXAuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbCkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsRWZmZWN0aXZlU2VsZWN0ZWRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBPYmplY3Qua2V5cyhtb2RlbEF0dHJpYnV0ZXMpKVxuICAgIGNvbnN0IGRlZmF1bHRBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgcmVzb3VyY2VJbnN0YW5jZSA9IHRoaXMuX3NlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlRm9yTW9kZWwobW9kZWwpXG5cbiAgICAvKipcbiAgICAgKiBSZXNvdXJjZSBhdHRyaWJ1dGUgbWV0aG9kIG5hbWUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc291cmNlIGF0dHJpYnV0ZSBtZXRob2QgbmFtZS5cbiAgICAgKi9cbiAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZU1ldGhvZE5hbWUgPSAoYXR0cmlidXRlTmFtZSkgPT4gYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVgXG5cbiAgICAvKipcbiAgICAgKiBSZXNvdXJjZSBoYXMgYXR0cmlidXRlLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZVtcInJlc291cmNlTWV0aG9kXCJdPn0gLSBSZXNvdXJjZSBhdHRyaWJ1dGUgbWV0aG9kIGRldGFpbHMuXG4gICAgICovXG4gICAgY29uc3QgcmVzb3VyY2VBdHRyaWJ1dGVNZXRob2QgPSAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgbWV0aG9kTmFtZSA9IHJlc291cmNlQXR0cmlidXRlTWV0aG9kTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICByZXR1cm4gcmVzb3VyY2VJbnN0YW5jZT8ucmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSkgfHwgbnVsbFxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByb3RvdHlwZSBhdHRyaWJ1dGUgbWV0aG9kLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge3ttZXRob2Q6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBvd25lck5hbWU6IHN0cmluZ30gfCB1bmRlZmluZWR9IC0gUHJvdG90eXBlIG1ldGhvZCBkZXRhaWxzIHdoZW4gcHJlc2VudC5cbiAgICAgKi9cbiAgICBjb25zdCBwcm90b3R5cGVBdHRyaWJ1dGVNZXRob2QgPSAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgbGV0IGN1cnJlbnRQcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YobW9kZWwpXG5cbiAgICAgIHdoaWxlIChjdXJyZW50UHJvdG90eXBlICYmIGN1cnJlbnRQcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihjdXJyZW50UHJvdG90eXBlLCBhdHRyaWJ1dGVOYW1lKT8udmFsdWVcblxuICAgICAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG1ldGhvZDogY2FuZGlkYXRlLFxuICAgICAgICAgICAgb3duZXJOYW1lOiBjdXJyZW50UHJvdG90eXBlLmNvbnN0cnVjdG9yPy5uYW1lXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY3VycmVudFByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50UHJvdG90eXBlKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNlcmlhbGl6ZWQgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNlcmlhbGl6ZWQgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqL1xuICAgIGNvbnN0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVWYWx1ZSA9IGFzeW5jIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICAvLyBDaGVjayByZXNvdXJjZSBpbnN0YW5jZSBmaXJzdCAodmlydHVhbC9jb21wdXRlZCBhdHRyaWJ1dGVzIHZpYSAke25hbWV9QXR0cmlidXRlIGNvbnZlbnRpb24pXG4gICAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZSA9IHJlc291cmNlQXR0cmlidXRlTWV0aG9kKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChyZXNvdXJjZUF0dHJpYnV0ZSkge1xuICAgICAgICByZXR1cm4gYXdhaXQgcmVzb3VyY2VBdHRyaWJ1dGUubWV0aG9kLmNhbGwocmVzb3VyY2VBdHRyaWJ1dGUucmVzb3VyY2UsIG1vZGVsKVxuICAgICAgfVxuXG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbW9kZWwgbWV0aG9kXG4gICAgICBjb25zdCBhdHRyaWJ1dGVNZXRob2RMb29rdXAgPSBwcm90b3R5cGVBdHRyaWJ1dGVNZXRob2QoYXR0cmlidXRlTmFtZSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IGF0dHJpYnV0ZU1ldGhvZExvb2t1cD8ubWV0aG9kXG5cbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTWV0aG9kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGF0dHJpYnV0ZU1ldGhvZC5jYWxsKG1vZGVsKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbW9kZWxBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXR0cmlidXRlIGV4aXN0cy5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBleGlzdHMuXG4gICAgICovXG4gICAgY29uc3QgYXR0cmlidXRlRXhpc3RzID0gKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBtb2RlbEF0dHJpYnV0ZXMpIHx8IChhdHRyaWJ1dGVOYW1lIGluIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobW9kZWwpKSB8fCBCb29sZWFuKHJlc291cmNlQXR0cmlidXRlTWV0aG9kKGF0dHJpYnV0ZU5hbWUpKVxuICAgIH1cblxuICAgIGlmICghc2VsZWN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIWRlZmF1bHRBdHRyaWJ1dGVzIHx8IGRlZmF1bHRBdHRyaWJ1dGVzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgcmV0dXJuIG1vZGVsQXR0cmlidXRlc1xuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIFNlcmlhbGl6ZWQgYXR0cmlidXRlcy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBzZXJpYWxpemVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBkZWZhdWx0QXR0cmlidXRlcykge1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZUV4aXN0cyhhdHRyaWJ1dGVOYW1lKSkgY29udGludWVcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCBzZXJpYWxpemVkQXR0cmlidXRlVmFsdWUoYXR0cmlidXRlTmFtZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2VyaWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgaWYgKCFhdHRyaWJ1dGVFeGlzdHMoYXR0cmlidXRlTmFtZSkpIGNvbnRpbnVlXG4gICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBzZXJpYWxpemVkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJlcXVlc3Qtc2NvcGVkIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UgY2FjaGUuXG4gICAqIEByZXR1cm5zIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxib29sZWFuLCBpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD4+fSAtIENhY2hlLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzKSB7XG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzID0gbmV3IE1hcCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb29rcyB1cCBhIGNhY2hlZCBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNSZWxhdGVkIC0gV2hldGhlciB0aGUgcmVzb3VyY2UgaXMgZm9yIGEgcmVsYXRlZCAobm9uLXJvb3QpIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ2FjaGVkIHJlc291cmNlIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIF9jYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBpc1JlbGF0ZWQpIHtcbiAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc01hcCgpLmdldChtb2RlbENsYXNzKT8uZ2V0KGlzUmVsYXRlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZXMgYSBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlIGluIHRoZSByZXF1ZXN0LXNjb3BlZCBjYWNoZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGlzUmVsYXRlZCAtIFdoZXRoZXIgdGhlIHJlc291cmNlIGlzIGZvciBhIHJlbGF0ZWQgKG5vbi1yb290KSBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gcmVzb3VyY2UgLSBSZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q2FjaGVkU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2UobW9kZWxDbGFzcywgaXNSZWxhdGVkLCByZXNvdXJjZSkge1xuICAgIGNvbnN0IGJ5Q2xhc3MgPSB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzTWFwKClcbiAgICBsZXQgYnlSZWxhdGVkID0gYnlDbGFzcy5nZXQobW9kZWxDbGFzcylcblxuICAgIGlmICghYnlSZWxhdGVkKSB7XG4gICAgICBieVJlbGF0ZWQgPSBuZXcgTWFwKClcbiAgICAgIGJ5Q2xhc3Muc2V0KG1vZGVsQ2xhc3MsIGJ5UmVsYXRlZClcbiAgICB9XG5cbiAgICBieVJlbGF0ZWQuc2V0KGlzUmVsYXRlZCwgcmVzb3VyY2UpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHBlci1pbnN0YW5jZSBob29rIGludm9rZWQgZm9yIGV2ZXJ5IHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2VcbiAgICogcmVzb2x1dGlvbi4gVGhlIGhvb2sgaXMgc2NvcGVkIHRvIHRoaXMgY29udHJvbGxlcjsgaXQgbmV2ZXIgYWZmZWN0cyBvdGhlclxuICAgKiBjb250cm9sbGVyIGluc3RhbmNlcy4gUGFzc2luZyBgbnVsbGAgY2xlYXJzIHRoZSBob29rLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgfCBudWxsfSBob29rIC0gSG9vayBjYWxsYmFjayBvciBudWxsLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDbGVhbnVwIGZ1bmN0aW9uIHRoYXQgcmVzdG9yZXMgdGhlIHByZXZpb3VzIGhvb2suXG4gICAqL1xuICBzZXRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2soaG9vaykge1xuICAgIGNvbnN0IHByZXZpb3VzSG9vayA9IHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2tcblxuICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgPSBob29rXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayA9IHByZXZpb3VzSG9va1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdCB8IG51bGx9IC0gUmVzb3VyY2UgaW5zdGFuY2Ugb3IgbnVsbC5cbiAgICovXG4gIF9zZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUZvck1vZGVsKG1vZGVsKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBpc1JlbGF0ZWQgPSBtb2RlbENsYXNzICE9PSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgY2FjaGVkUmVzb3VyY2UgPSB0aGlzLl9jYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBpc1JlbGF0ZWQpXG5cbiAgICBpZiAoY2FjaGVkUmVzb3VyY2UpIHtcbiAgICAgIGlmICh0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rKSB7XG4gICAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sobW9kZWwsIGNhY2hlZFJlc291cmNlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2FjaGVkUmVzb3VyY2VcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICBsZXQgcmVzb3VyY2VcblxuICAgIGlmICghaXNSZWxhdGVkKSB7XG4gICAgICByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgICB0aGlzLl9zZXRDYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBmYWxzZSwgcmVzb3VyY2UpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgICAgY29uc3QgbW9kZWxDbGFzc05hbWUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIHJlc291cmNlID0gbnVsbFxuXG4gICAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbENsYXNzTmFtZV1cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc291cmNlRGVmaW5pdGlvbiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSA6IG51bGxcblxuICAgICAgICBpZiAocmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHJlc291cmNlID0gbmV3IHJlc291cmNlQ2xhc3Moe1xuICAgICAgICAgICAgYWJpbGl0eTogdGhpcy5jdXJyZW50QWJpbGl0eSgpLFxuICAgICAgICAgICAgLy8gUHJvcGFnYXRlIHRoZSBjb250cm9sbGVyIHNvIGEgcmVsYXRlZC9wcmVsb2FkZWQgbW9kZWwncyBzZXJpYWxpemF0aW9uXG4gICAgICAgICAgICAvLyByZXNvdXJjZSBjYW4gdXNlIHJlcXVlc3QgY29udGV4dCAoZS5nLiBgcmVxdWVzdEJhc2VVcmwoKWAgZm9yIHNpZ25lZFxuICAgICAgICAgICAgLy8gZG93bmxvYWQgVVJMcykuIFdpdGhvdXQgaXQsIGFueSBgPGF0dHI+QXR0cmlidXRlYCBtZXRob2QgdGhhdCByZWFjaGVzXG4gICAgICAgICAgICAvLyBmb3IgdGhlIGNvbnRyb2xsZXIgdGhyb3dzIFwicmVxdWlyZXMgYSBjb250cm9sbGVyIGluc3RhbmNlLlwiIHdoZW4gYVxuICAgICAgICAgICAgLy8gcmVsYXRpb25zaGlwIGlzIHNlcmlhbGl6ZWQgYXMgYSBwcmVsb2FkLlxuICAgICAgICAgICAgY29udHJvbGxlcjogdGhpcyxcbiAgICAgICAgICAgIGNvbnRleHQ6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0Q29udGV4dCgpIHx8IHt9LFxuICAgICAgICAgICAgbG9jYWxzOiB0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldExvY2FscygpIHx8IHt9LFxuICAgICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzc05hbWUsXG4gICAgICAgICAgICBwYXJhbXM6IHt9LFxuICAgICAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgdGhpcy5fc2V0Q2FjaGVkU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2UobW9kZWxDbGFzcywgdHJ1ZSwgcmVzb3VyY2UpXG5cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2spIHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sobW9kZWwsIHJlc291cmNlKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZmlsdGVyIHNlcmlhbGl6YWJsZSByZWxhdGVkIG1vZGVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSBhcmdzLm1vZGVscyAtIEZyb250ZW5kIG1vZGVsIHJlY29yZHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb24gLSBXaGV0aGVyIHJlbGF0aW9uIGlzIGhhcy1tYW55LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIFNlcmlhbGl6YWJsZSByZWxhdGVkIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaWx0ZXJTZXJpYWxpemFibGVSZWxhdGVkTW9kZWxzKHttb2RlbHMsIHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvbn0pIHtcbiAgICBpZiAoIXRoaXMuY3VycmVudEFiaWxpdHkoKSkgcmV0dXJuIG1vZGVsc1xuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm4gbW9kZWxzXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbHMgYnkgY2xhc3MuXG4gICAgICogQHR5cGUge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gKi9cbiAgICBjb25zdCBtb2RlbHNCeUNsYXNzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCBleGlzdGluZ01vZGVsc0ZvckNsYXNzID0gbW9kZWxzQnlDbGFzcy5nZXQocmVsYXRlZE1vZGVsQ2xhc3MpIHx8IFtdXG5cbiAgICAgIGV4aXN0aW5nTW9kZWxzRm9yQ2xhc3MucHVzaChtb2RlbClcbiAgICAgIG1vZGVsc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBleGlzdGluZ01vZGVsc0ZvckNsYXNzKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF1dGhvcml6ZWQgaWRzIGJ5IGNsYXNzLlxuICAgICAqIEB0eXBlIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIFNldDxzdHJpbmc+Pn0gKi9cbiAgICBjb25zdCBhdXRob3JpemVkSWRzQnlDbGFzcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIFByaW1hcnkga2V5cyBieSBjbGFzcy5cbiAgICAgKiBAdHlwZSB7TWFwPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IHByaW1hcnlLZXlzQnlDbGFzcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbcmVsYXRlZE1vZGVsQ2xhc3MsIHJlbGF0ZWRNb2RlbHNdIG9mIG1vZGVsc0J5Q2xhc3MuZW50cmllcygpKSB7XG4gICAgICBjb25zdCByZWxhdGVkUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKHJlbGF0ZWRNb2RlbENsYXNzKVxuXG4gICAgICBpZiAoIXJlbGF0ZWRSZXNvdXJjZSkge1xuICAgICAgICBhdXRob3JpemVkSWRzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIG5ldyBTZXQoKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvblxuICAgICAgICA/IHJlbGF0ZWRSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzPy5pbmRleFxuICAgICAgICA6IHJlbGF0ZWRSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzPy5maW5kXG5cbiAgICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgYXV0aG9yaXplZElkc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBuZXcgU2V0KCkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSByZWxhdGVkTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IGlkcyA9IHJlbGF0ZWRNb2RlbHNcbiAgICAgICAgLm1hcCgobW9kZWwpID0+IG1vZGVsLmF0dHJpYnV0ZXMoKVtwcmltYXJ5S2V5XSlcbiAgICAgICAgLmZpbHRlcigoaWQpID0+IGlkICE9PSB1bmRlZmluZWQgJiYgaWQgIT09IG51bGwpXG5cbiAgICAgIGlmIChpZHMubGVuZ3RoIDwgMSkge1xuICAgICAgICBhdXRob3JpemVkSWRzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIG5ldyBTZXQoKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXV0aG9yaXplZElkc1JhdyA9IGF3YWl0IHJlbGF0ZWRNb2RlbENsYXNzXG4gICAgICAgIC5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24pXG4gICAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiBpZHN9KVxuICAgICAgICAucGx1Y2socHJpbWFyeUtleSlcblxuICAgICAgcHJpbWFyeUtleXNCeUNsYXNzLnNldChyZWxhdGVkTW9kZWxDbGFzcywgcHJpbWFyeUtleSlcbiAgICAgIGF1dGhvcml6ZWRJZHNCeUNsYXNzLnNldChyZWxhdGVkTW9kZWxDbGFzcywgbmV3IFNldChhdXRob3JpemVkSWRzUmF3Lm1hcCgoaWQpID0+IFN0cmluZyhpZCkpKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbW9kZWxzLmZpbHRlcigobW9kZWwpID0+IHtcbiAgICAgIGNvbnN0IHJlbGF0ZWRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsLmNvbnN0cnVjdG9yKVxuICAgICAgY29uc3QgYXV0aG9yaXplZElkcyA9IGF1dGhvcml6ZWRJZHNCeUNsYXNzLmdldChyZWxhdGVkTW9kZWxDbGFzcylcbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBwcmltYXJ5S2V5c0J5Q2xhc3MuZ2V0KHJlbGF0ZWRNb2RlbENsYXNzKVxuXG4gICAgICBpZiAoIWF1dGhvcml6ZWRJZHMgfHwgIXByaW1hcnlLZXkpIHJldHVybiBmYWxzZVxuXG4gICAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWUgPSBtb2RlbC5hdHRyaWJ1dGVzKClbcHJpbWFyeUtleV1cblxuICAgICAgaWYgKHByaW1hcnlLZXlWYWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHByaW1hcnlLZXlWYWx1ZSA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiBhdXRob3JpemVkSWRzLmhhcyhTdHJpbmcocHJpbWFyeUtleVZhbHVlKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgc2VyaWFsaXphYmxlIGZyb250ZW5kIG1vZGVsLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBwcmVsb2FkZWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFdoZXRoZXIgdmFsdWUgYmVoYXZlcyBsaWtlIGEgbW9kZWwuXG4gICAqL1xuICBpc1NlcmlhbGl6YWJsZUZyb250ZW5kTW9kZWwodmFsdWUpIHtcbiAgICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXR0cmlidXRlcyA9PT0gXCJmdW5jdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IG1vZGVscyAtIE1vZGVscyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWRzLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMobW9kZWxzKSB7XG4gICAgaWYgKG1vZGVscy5sZW5ndGggPCAxKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIFByZWxvYWRlZCByZWxhdGlvbnNoaXBzIHBlciBtb2RlbC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWwgPSBBcnJheS5mcm9tKHtsZW5ndGg6IG1vZGVscy5sZW5ndGh9LCAoKSA9PiAoe30pKVxuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxhdGlvbnNoaXAgZW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2xvYWRlZE1vZGVsczogaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdLCBtb2RlbEluZGV4OiBudW1iZXIsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzID0gW11cbiAgICAvKipcbiAgICAgKiBTaW5ndWxhciByZWxhdGlvbnNoaXAgZW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2xvYWRlZE1vZGVsOiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBtb2RlbEluZGV4OiBudW1iZXIsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcyA9IFtdXG5cbiAgICBtb2RlbHMuZm9yRWFjaCgobW9kZWwsIG1vZGVsSW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBzTWFwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5fc2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VGb3JNb2RlbChtb2RlbClcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IHJlc291cmNlID8gcmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uKCkgOiBudWxsXG4gICAgICBjb25zdCBleHBvc2VkUmVsYXRpb25zaGlwcyA9IG5ldyBTZXQoXG4gICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbiAmJiBBcnJheS5pc0FycmF5KHJlc291cmNlQ29uZmlndXJhdGlvbi5yZWxhdGlvbnNoaXBzKVxuICAgICAgICAgID8gcmVzb3VyY2VDb25maWd1cmF0aW9uLnJlbGF0aW9uc2hpcHNcbiAgICAgICAgICA6IFtdXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiByZWxhdGlvbnNoaXBzTWFwKSB7XG4gICAgICAgIGlmICghZXhwb3NlZFJlbGF0aW9uc2hpcHMuaGFzKHJlbGF0aW9uc2hpcE5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICAgIGlmICghcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGxvYWRlZFJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZFJlbGF0aW9uc2hpcCkpIHtcbiAgICAgICAgICBjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcy5wdXNoKHtsb2FkZWRNb2RlbHM6IGxvYWRlZFJlbGF0aW9uc2hpcCwgbW9kZWxJbmRleCwgcmVsYXRpb25zaGlwTmFtZX0pXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLmlzU2VyaWFsaXphYmxlRnJvbnRlbmRNb2RlbChsb2FkZWRSZWxhdGlvbnNoaXApKSB7XG4gICAgICAgICAgc2luZ3VsYXJSZWxhdGlvbnNoaXBFbnRyaWVzLnB1c2goe2xvYWRlZE1vZGVsOiBsb2FkZWRSZWxhdGlvbnNoaXAsIG1vZGVsSW5kZXgsIHJlbGF0aW9uc2hpcE5hbWV9KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbbW9kZWxJbmRleF1bcmVsYXRpb25zaGlwTmFtZV0gPSBsb2FkZWRSZWxhdGlvbnNoaXAgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFJlbGF0aW9uc2hpcFxuICAgICAgfVxuICAgIH0pXG5cbiAgICBpZiAoY29sbGVjdGlvblJlbGF0aW9uc2hpcEVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYWxsQ29sbGVjdGlvbk1vZGVscyA9IGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzLmZsYXRNYXAoKGVudHJ5KSA9PiBlbnRyeS5sb2FkZWRNb2RlbHMpXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyU2VyaWFsaXphYmxlUmVsYXRlZE1vZGVscyh7XG4gICAgICAgIG1vZGVsczogYWxsQ29sbGVjdGlvbk1vZGVscyxcbiAgICAgICAgcmVsYXRpb25zaGlwSXNDb2xsZWN0aW9uOiB0cnVlXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXphYmxlQ29sbGVjdGlvbk1vZGVsc1NldCA9IG5ldyBTZXQoc2VyaWFsaXphYmxlQ29sbGVjdGlvbk1vZGVscylcblxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBFbnRyeSBvZiBjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcykge1xuICAgICAgICBjb25zdCBhbGxvd2VkTW9kZWxzID0gcmVsYXRpb25zaGlwRW50cnkubG9hZGVkTW9kZWxzLmZpbHRlcigocmVsYXRlZE1vZGVsKSA9PiBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzU2V0LmhhcyhyZWxhdGVkTW9kZWwpKVxuICAgICAgICBjb25zdCBzZXJpYWxpemVkUmVsYXRlZE1vZGVscyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMoYWxsb3dlZE1vZGVscylcblxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBzZXJpYWxpemVkUmVsYXRlZE1vZGVsc1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYWxsU2luZ3VsYXJNb2RlbHMgPSBzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMubWFwKChlbnRyeSkgPT4gZW50cnkubG9hZGVkTW9kZWwpXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVTaW5ndWxhck1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlclNlcmlhbGl6YWJsZVJlbGF0ZWRNb2RlbHMoe1xuICAgICAgICBtb2RlbHM6IGFsbFNpbmd1bGFyTW9kZWxzLFxuICAgICAgICByZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb246IGZhbHNlXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXphYmxlU2luZ3VsYXJNb2RlbHNTZXQgPSBuZXcgU2V0KHNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzKVxuXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcEVudHJ5IG9mIHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcykge1xuICAgICAgICBpZiAoIXNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzU2V0LmhhcyhyZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbCkpIHtcbiAgICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBudWxsXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IChhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxzKFtyZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbF0pKVswXVxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBzZXJpYWxpemVkTW9kZWxcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVkIG1vZGVscy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W119ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZE1vZGVscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFttb2RlbEluZGV4LCBtb2RlbF0gb2YgbW9kZWxzLmVudHJpZXMoKSkge1xuICAgICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsKVxuICAgICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFttb2RlbEluZGV4XVxuICAgICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBtb2RlbC5hc3NvY2lhdGlvbkNvdW50cygpXG4gICAgICBjb25zdCBxdWVyeURhdGFWYWx1ZXMgPSBtb2RlbC5xdWVyeURhdGFWYWx1ZXMoKVxuICAgICAgY29uc3QgY29tcHV0ZWRBYmlsaXRpZXMgPSBtb2RlbC5jb21wdXRlZEFiaWxpdGllcygpXG4gICAgICBjb25zdCBoYXNDb3VudHMgPSBPYmplY3Qua2V5cyhhc3NvY2lhdGlvbkNvdW50cykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzUXVlcnlEYXRhID0gT2JqZWN0LmtleXMocXVlcnlEYXRhVmFsdWVzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNBYmlsaXRpZXMgPSBPYmplY3Qua2V5cyhjb21wdXRlZEFiaWxpdGllcykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzUHJlbG9hZGVkID0gT2JqZWN0LmtleXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykubGVuZ3RoID4gMFxuXG4gICAgICBpZiAoIWhhc1ByZWxvYWRlZCAmJiAhaGFzQ291bnRzICYmICFoYXNRdWVyeURhdGEgJiYgIWhhc0FiaWxpdGllcykge1xuICAgICAgICBzZXJpYWxpemVkTW9kZWxzLnB1c2goc2VyaWFsaXplZEF0dHJpYnV0ZXMpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2VyaWFsaXplZC5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBzZXJpYWxpemVkID0gey4uLnNlcmlhbGl6ZWRBdHRyaWJ1dGVzfVxuXG4gICAgICBpZiAoaGFzUHJlbG9hZGVkKSBzZXJpYWxpemVkLl9fcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICAgIGlmIChoYXNDb3VudHMpIHNlcmlhbGl6ZWQuX19hc3NvY2lhdGlvbkNvdW50cyA9IGFzc29jaWF0aW9uQ291bnRzXG4gICAgICBpZiAoaGFzUXVlcnlEYXRhKSBzZXJpYWxpemVkLl9fcXVlcnlEYXRhID0gcXVlcnlEYXRhVmFsdWVzXG4gICAgICBpZiAoaGFzQWJpbGl0aWVzKSBzZXJpYWxpemVkLl9fYWJpbGl0aWVzID0gY29tcHV0ZWRBYmlsaXRpZXNcblxuICAgICAgc2VyaWFsaXplZE1vZGVscy5wdXNoKHNlcmlhbGl6ZWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIHNlcmlhbGl6ZWRNb2RlbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6ZSBmcm9udGVuZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIEZyb250ZW5kIG1vZGVsIHJlY29yZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIGZyb250ZW5kIG1vZGVsIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVGcm9udGVuZE1vZGVsKG1vZGVsKSB7XG4gICAgY29uc3Qgc2VyaWFsaXplZE1vZGVscyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMoW21vZGVsXSlcblxuICAgIHJldHVybiBzZXJpYWxpemVkTW9kZWxzWzBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZW5kZXIgZXJyb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBlcnJvck1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGVycm9yIGhhcyBiZWVuIHJlbmRlcmVkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbFJlbmRlckVycm9yKGVycm9yTWVzc2FnZSkge1xuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmVycm9yKGBGcm9udGVuZCBtb2RlbCByZXF1ZXN0IGZhaWxlZDogJHtlcnJvck1lc3NhZ2V9YClcblxuICAgIGNvbnN0IHJlbmRlckVycm9yID0gLyoqIEB0eXBlIHsoKGVycm9yTWVzc2FnZTogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+KSB8IHVuZGVmaW5lZH0gKi8gKFxuICAgICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpLnJlbmRlckVycm9yXG4gICAgKVxuXG4gICAgaWYgKHR5cGVvZiByZW5kZXJFcnJvciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCByZW5kZXJFcnJvci5jYWxsKHRoaXMsIGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JNZXNzYWdlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoe1xuICAgICAgICBlcnJvck1lc3NhZ2U6IGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JNZXNzYWdlLFxuICAgICAgICBzdGF0dXM6IFwiZXJyb3JcIlxuICAgICAgfSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZXJyb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGVycm9yTWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBTdHJ1Y3R1cmVkIGVycm9yIGZpZWxkcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfSBbb3B0aW9ucy5kZXRhaWxzXSAtIENsaWVudC1zYWZlIGRldGFpbHMuXG4gICAqIEBwYXJhbSB7XCJhcHBsaWNhdGlvbl9lcnJvclwiIHwgXCJhdXRob3JpemF0aW9uX2Vycm9yXCIgfCBcImludGVybmFsX2Vycm9yXCIgfCBcInJlY29yZF9ub3RfZm91bmRcIiB8IFwidmFsaWRhdGlvbl9lcnJvclwifSBbb3B0aW9ucy5lcnJvclR5cGVdIC0gU3RhYmxlIGNsaWVudC1mYWNpbmcgZXJyb3IgY2F0ZWdvcnkuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRXJyb3IgcGF5bG9hZC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoZXJyb3JNZXNzYWdlLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4uKG9wdGlvbnMuZGV0YWlscyA/IHtkZXRhaWxzOiBvcHRpb25zLmRldGFpbHN9IDoge30pLFxuICAgICAgZXJyb3JNZXNzYWdlLFxuICAgICAgLi4uKG9wdGlvbnMuZXJyb3JUeXBlID8ge2Vycm9yVHlwZTogb3B0aW9ucy5lcnJvclR5cGV9IDoge30pLFxuICAgICAgc3RhdHVzOiBcImVycm9yXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjbGllbnQgc2FmZSBlcnJvciBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsaWVudC1zYWZlIGVycm9yIHBheWxvYWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yUGF5bG9hZCgpIHtcbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JNZXNzYWdlKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBmcm9udGVuZC1tb2RlbCBlbmRwb2ludCBlcnJvciBjb250ZXh0IGZvciBsb2dnaW5nIGFuZCBjbGllbnQgcGF5bG9hZCByZXBvcnRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRXJyb3IgY29udGV4dCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY3Rpb24gLSBFbmRwb2ludC9hY3Rpb24gbGFiZWwuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5lcnJvciAtIENhdWdodCBlcnJvci5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIiB8IFwiY3VzdG9tLWNvbW1hbmRcIn0gW2FyZ3MuY29tbWFuZFR5cGVdIC0gRnJvbnRlbmQtbW9kZWwgY29tbWFuZCB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MubW9kZWxdIC0gUmVxdWVzdCBtb2RlbCBuYW1lIHdoZW4gYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MucmVxdWVzdElkXSAtIEJhdGNoIHJlcXVlc3QgaWQgd2hlbiBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHR9IEZyb250ZW5kLW1vZGVsIGVuZHBvaW50IGVycm9yIGNvbnRleHQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe2FjdGlvbiwgY29tbWFuZFR5cGUsIGVycm9yLCBtb2RlbCwgcmVxdWVzdElkfSkge1xuICAgIGxldCByZXNvbHZlZE1vZGVsID0gbW9kZWxcbiAgICBjb25zdCBleHBlY3RlZEVycm9yID0gZnJvbnRlbmRNb2RlbEV4cGVjdGVkRXJyb3IoZXJyb3IpXG5cbiAgICBpZiAoIXJlc29sdmVkTW9kZWwpIHtcbiAgICAgIGNvbnN0IGNhY2hlZFBhcmFtcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZSB8fCB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zXG4gICAgICBjb25zdCBwYXJhbXNNb2RlbCA9IGNhY2hlZFBhcmFtcyA/IGNhY2hlZFBhcmFtcy5tb2RlbCA6IHVuZGVmaW5lZFxuICAgICAgcmVzb2x2ZWRNb2RlbCA9IHR5cGVvZiBwYXJhbXNNb2RlbCA9PT0gXCJzdHJpbmdcIiAmJiBwYXJhbXNNb2RlbC5sZW5ndGggPiAwID8gcGFyYW1zTW9kZWwgOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWN0aW9uLFxuICAgICAgY29tbWFuZFR5cGUsXG4gICAgICBjb250cm9sbGVyOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICAuLi4oZXhwZWN0ZWRFcnJvciA/IHt9IDoge2NvcnJlbGF0aW9uSWQ6IHJhbmRvbVVVSUQoKX0pLFxuICAgICAgZXhwZWN0ZWRFcnJvcixcbiAgICAgIGZyb250ZW5kTW9kZWxFbmRwb2ludDogdHJ1ZSxcbiAgICAgIG1vZGVsOiByZXNvbHZlZE1vZGVsLFxuICAgICAgcmVxdWVzdElkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY2xpZW50IGVycm9yIHBheWxvYWQgZm9yIGVycm9yLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCB8IHVuZGVmaW5lZH0gW2VuZHBvaW50RXJyb3JDb250ZXh0XSAtIEZyb250ZW5kLW1vZGVsIGVuZHBvaW50IGVycm9yIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWQ+fSAtIENsaWVudCBwYXlsb2FkIGZvciB0aGUgY3VycmVudCBlbnZpcm9ubWVudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZW5kcG9pbnRFcnJvckNvbnRleHQpIHtcbiAgICBjb25zdCB2ZWxvY2lvdXNNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxWZWxvY2lvdXNNZXRhZGF0YUZvckVycm9yKGVycm9yKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gKi9cbiAgICBjb25zdCBzYWZlRXJyb3JQYXlsb2FkID0ge31cblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkge1xuICAgICAgaWYgKGVycm9yLmVycm9yVHlwZSkgc2FmZUVycm9yUGF5bG9hZC5lcnJvclR5cGUgPSBlcnJvci5lcnJvclR5cGVcbiAgICAgIGlmIChlcnJvci5kZXRhaWxzKSBzYWZlRXJyb3JQYXlsb2FkLmRldGFpbHMgPSBlcnJvci5kZXRhaWxzXG4gICAgfSBlbHNlIGlmIChlcnJvciBpbnN0YW5jZW9mIFJlY29yZE5vdEZvdW5kRXJyb3IpIHtcbiAgICAgIHNhZmVFcnJvclBheWxvYWQuZXJyb3JUeXBlID0gXCJyZWNvcmRfbm90X2ZvdW5kXCJcbiAgICB9IGVsc2UgaWYgKHZlbG9jaW91c01ldGFkYXRhKSB7XG4gICAgICBpZiAodHlwZW9mIHZlbG9jaW91c01ldGFkYXRhLmVycm9yVHlwZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBzYWZlRXJyb3JQYXlsb2FkLmVycm9yVHlwZSA9IHZlbG9jaW91c01ldGFkYXRhLmVycm9yVHlwZVxuICAgICAgfVxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QodmVsb2Npb3VzTWV0YWRhdGEuZGV0YWlscykpIHtcbiAgICAgICAgc2FmZUVycm9yUGF5bG9hZC5kZXRhaWxzID0gdmVsb2Npb3VzTWV0YWRhdGEuZGV0YWlsc1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCB2YWxpZGF0aW9uRXJyb3JzUGF5bG9hZCA9IHt9XG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvcnMgPSBlcnJvci5nZXRWYWxpZGF0aW9uRXJyb3JzKClcbiAgICAgIGNvbnN0IG1vZGVsID0gZXJyb3IuZ2V0TW9kZWwoKVxuICAgICAgLyoqXG4gICAgICAgKiBTdHJ1Y3R1cmVkIGVycm9ycy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIGZ1bGxNZXNzYWdlOiBzdHJpbmd9W10+fSAqL1xuICAgICAgY29uc3Qgc3RydWN0dXJlZEVycm9ycyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBpbiB2YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgICAgIHN0cnVjdHVyZWRFcnJvcnNbYXR0cmlidXRlTmFtZV0gPSB2YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdLm1hcChlcnIgPT4gKHtcbiAgICAgICAgICB0eXBlOiBlcnIudHlwZSxcbiAgICAgICAgICBtZXNzYWdlOiBlcnIubWVzc2FnZSxcbiAgICAgICAgICBmdWxsTWVzc2FnZTogYCR7bW9kZWwuZ2V0TW9kZWxDbGFzcygpLmh1bWFuQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKX0gJHtlcnIubWVzc2FnZX1gXG4gICAgICAgIH0pKVxuICAgICAgfVxuXG4gICAgICB2YWxpZGF0aW9uRXJyb3JzUGF5bG9hZCA9IHtcbiAgICAgICAgZXJyb3JUeXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIixcbiAgICAgICAgdmFsaWRhdGlvbkVycm9yczogc3RydWN0dXJlZEVycm9yc1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlcG9ydGVyUGF5bG9hZCA9IGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmNsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKHtcbiAgICAgIGNvbnRleHQ6IGVuZHBvaW50RXJyb3JDb250ZXh0IHx8IHtjb250cm9sbGVyOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LFxuICAgICAgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvcixcbiAgICAgIHJlcXVlc3Q6IHRoaXMuZ2V0UmVxdWVzdCgpXG4gICAgfSlcblxuICAgIGlmICghdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSkge1xuICAgICAgZGVsZXRlIHJlcG9ydGVyUGF5bG9hZC5kZWJ1Z0JhY2t0cmFjZVxuICAgICAgZGVsZXRlIHJlcG9ydGVyUGF5bG9hZC5kZWJ1Z0Vycm9yQ2xhc3NcbiAgICAgIGRlbGV0ZSByZXBvcnRlclBheWxvYWQuZGVidWdFcnJvck1lc3NhZ2VcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ucmVwb3J0ZXJQYXlsb2FkLFxuICAgICAgLi4udGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGZyb250ZW5kTW9kZWxDbGllbnRNZXNzYWdlRm9yRXJyb3IoXG4gICAgICAgIGVycm9yLFxuICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpXG4gICAgICApKSxcbiAgICAgIC4uLmZyb250ZW5kTW9kZWxEZWJ1Z1BheWxvYWRGb3JFcnJvcih7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBlcnJvclxuICAgICAgfSksXG4gICAgICAuLi4odmVsb2Npb3VzTWV0YWRhdGEgPyB7dmVsb2Npb3VzOiB2ZWxvY2lvdXNNZXRhZGF0YX0gOiB7fSksXG4gICAgICAuLi5zYWZlRXJyb3JQYXlsb2FkLFxuICAgICAgLi4udmFsaWRhdGlvbkVycm9yc1BheWxvYWQsXG4gICAgICAuLi4oIWVuZHBvaW50RXJyb3JDb250ZXh0Py5leHBlY3RlZEVycm9yICYmIGVuZHBvaW50RXJyb3JDb250ZXh0Py5jb3JyZWxhdGlvbklkXG4gICAgICAgID8ge2NvcnJlbGF0aW9uSWQ6IGVuZHBvaW50RXJyb3JDb250ZXh0LmNvcnJlbGF0aW9uSWQsIGVycm9yVHlwZTogXCJpbnRlcm5hbF9lcnJvclwifVxuICAgICAgICA6IHt9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGxvZyBlbmRwb2ludCBlcnJvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFcnJvciBsb2cgYXJncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIENhdWdodCBlcnJvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHR9IGFyZ3MuZXJyb3JDb250ZXh0IC0gU2hhcmVkIGNsaWVudC9sb2dnaW5nIGVycm9yIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGxvZ2dpbmcuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pIHtcbiAgICAvLyBFeHBlY3RlZCB1c2VyLWZsb3cgZXJyb3JzIGFyZSBzdXJmYWNlZCB0byBjbGllbnRzIGJ5XG4gICAgLy8gZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yLCBidXQgc2tpcHBlZCBoZXJlIHNvIG1vbml0b3JpbmdcbiAgICAvLyBzdGF5cyBmb2N1c2VkIG9uIHJlYWwgYmFja2VuZCBmYWlsdXJlcy5cbiAgICBpZiAoZXJyb3JDb250ZXh0LmV4cGVjdGVkRXJyb3IpIHJldHVyblxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcmVkYWN0b3IgPSBjb25maWd1cmF0aW9uLmdldExvZ1JlZGFjdG9yKClcbiAgICBjb25zdCByZXF1ZXN0VGltaW5nID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgY29uc3Qgc2Vuc2l0aXZlVmFsdWVzID0gcmVxdWVzdFRpbWluZyA/IHJlcXVlc3RUaW1pbmcuZ2V0TG9nU2Vuc2l0aXZlVmFsdWVzKCkgOiBuZXcgU2V0KClcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICBjb25zdCByZWRhY3RlZEVycm9yID0gcmVkYWN0b3IucmVkYWN0RXJyb3Iobm9ybWFsaXplZEVycm9yLCBzZW5zaXRpdmVWYWx1ZXMpXG4gICAgY29uc3QgcmVkYWN0ZWRDb250ZXh0ID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHR9ICovIChyZWRhY3Rvci5yZWRhY3RTdHJ1Y3R1cmVkKGVycm9yQ29udGV4dCwgc2Vuc2l0aXZlVmFsdWVzKSlcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmVycm9yKCgpID0+IFtcIkZyb250ZW5kIG1vZGVsIGVuZHBvaW50IHJlcXVlc3QgZmFpbGVkXCIsIHtcbiAgICAgIGFjdGlvbjogcmVkYWN0ZWRDb250ZXh0LmFjdGlvbixcbiAgICAgIGNvbW1hbmRUeXBlOiByZWRhY3RlZENvbnRleHQuY29tbWFuZFR5cGUsXG4gICAgICBjb3JyZWxhdGlvbklkOiByZWRhY3RlZENvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGVycm9yQmFja3RyYWNlOiByZWRhY3RlZEVycm9yLnN0YWNrLFxuICAgICAgZXJyb3JDbGFzczogcmVkYWN0ZWRFcnJvci5uYW1lLFxuICAgICAgZXJyb3JNZXNzYWdlOiByZWRhY3RlZEVycm9yLm1lc3NhZ2UsXG4gICAgICBtb2RlbDogcmVkYWN0ZWRDb250ZXh0Lm1vZGVsLFxuICAgICAgcmVxdWVzdElkOiByZWRhY3RlZENvbnRleHQucmVxdWVzdElkXG4gICAgfV0pXG5cbiAgICAvLyBTdXJmYWNlIGdlbnVpbmVseSB1bmV4cGVjdGVkIGJhY2tlbmQgZmFpbHVyZXMgb24gdGhlIGZyYW1ld29yay1lcnJvclxuICAgIC8vIGNoYW5uZWwgc28gcHJvY2Vzcy1sZXZlbCBidWcgcmVwb3J0ZXJzIGNhcHR1cmUgdGhlbSwgaW5zdGVhZCBvZiB0aGVcbiAgICAvLyBjb250cm9sbGVyIHNpbGVudGx5IHN3YWxsb3dpbmcgdGhlbSBiZWhpbmQgdGhlIGdlbmVyaWMgXCJSZXF1ZXN0XG4gICAgLy8gZmFpbGVkLlwiIGNsaWVudCBtZXNzYWdlLlxuICAgIGNvbnN0IGVycm9yUGF5bG9hZCA9IHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHJlZGFjdGVkQ29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgY29udGV4dDogcmVkYWN0ZWRDb250ZXh0LFxuICAgICAgZXJyb3I6IHJlZGFjdGVkRXJyb3IsXG4gICAgICByZXF1ZXN0OiB0aGlzLmdldFJlcXVlc3QoKSxcbiAgICAgIHJlcXVlc3REZXRhaWxzOiByZXF1ZXN0RGV0YWlscyh0aGlzLmdldFJlcXVlc3QoKSwge3JlZGFjdG9yLCBzZW5zaXRpdmVWYWx1ZXN9KVxuICAgIH1cblxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImZyYW1ld29yay1lcnJvclwiLCBlcnJvclBheWxvYWQpXG4gICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiYWxsLWVycm9yXCIsIHsuLi5lcnJvclBheWxvYWQsIGVycm9yVHlwZTogXCJmcmFtZXdvcmstZXJyb3JcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZW5kZXIgY29tbWFuZCByZXNwb25zZS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHJlc3BvbnNlIGhhcyBiZWVuIHJlbmRlcmVkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShhY3Rpb24pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tbWFuZFBheWxvYWQoYWN0aW9uKVxuICAgICAgaWYgKCFyZXNwb25zZVBheWxvYWQpIHJldHVyblxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlc3BvbnNlUGF5bG9hZCwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHthY3Rpb24sIGNvbW1hbmRUeXBlOiBhY3Rpb24sIGVycm9yfSlcblxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dCksIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvbW1hbmQgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbENvbW1hbmRQYXlsb2FkKGFjdGlvbikge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKVxuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5ydW5Gcm9udGVuZE1vZGVsQmVmb3JlQWN0aW9uKGFjdGlvbikpKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImluZGV4XCIpIHtcbiAgICAgIGlmICh0aGlzLmZyb250ZW5kTW9kZWxDb3VudFJlcXVlc3RlZCgpKSB7XG4gICAgICAgIGlmICghKGF3YWl0IHJlc291cmNlLnN1cHBvcnRzQ291bnQoXCJpbmRleFwiKSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb3VudCBpcyBub3Qgc3VwcG9ydGVkIHdoZW4gcmVzb3VyY2UgcmVjb3JkcyBhcmUgY3VzdG9taXplZFwiKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb3VudDogYXdhaXQgcmVzb3VyY2UuY291bnQoKSxcbiAgICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgcGx1Y2sgPSB0aGlzLmZyb250ZW5kTW9kZWxQbHVjaygpXG5cbiAgICAgIGlmIChwbHVjay5sZW5ndGggPiAwKSB7XG4gICAgICAgIGlmICghKGF3YWl0IHJlc291cmNlLnN1cHBvcnRzUGx1Y2soXCJpbmRleFwiKSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwbHVjayBpcyBub3Qgc3VwcG9ydGVkIHdoZW4gcmVzb3VyY2UgcmVjb3JkcyBhcmUgY3VzdG9taXplZFwiKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgdmFsdWVzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUGx1Y2tWYWx1ZXMoe1xuICAgICAgICAgIHBsdWNrLFxuICAgICAgICAgIHF1ZXJ5OiByZXNvdXJjZS5pbmRleFF1ZXJ5KClcbiAgICAgICAgfSlcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCIsXG4gICAgICAgICAgdmFsdWVzXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVjb3JkcygpXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKG1vZGVscylcbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbHMgPSBhd2FpdCBQcm9taXNlLmFsbChtb2RlbHMubWFwKGFzeW5jIChtb2RlbCkgPT4gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKG1vZGVsLCBcImluZGV4XCIpKSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbW9kZWxzOiBzZXJpYWxpemVkTW9kZWxzLFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKClcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGlkID0gcGFyYW1zLmlkXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImNyZWF0ZVwiKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgbXV0YXRpb25BdHRyaWJ1dGVzID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKG11dGF0aW9uQXR0cmlidXRlcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDcmVhdGVSZWNvcmQoXG4gICAgICAgIG11dGF0aW9uQXR0cmlidXRlcy5hdHRyaWJ1dGVzLFxuICAgICAgICBtdXRhdGlvbkF0dHJpYnV0ZXMubmVzdGVkQXR0cmlidXRlcyxcbiAgICAgICAgbXV0YXRpb25BdHRyaWJ1dGVzLmF0dGFjaG1lbnRzXG4gICAgICApXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZShtb2RlbCwgXCJjcmVhdGVcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBpZiAoKHR5cGVvZiBpZCAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgaWQgIT09IFwibnVtYmVyXCIpIHx8IGAke2lkfWAubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIG1vZGVsIGlkLlwiLCB7ZXJyb3JUeXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJhdHRhY2hcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudE5hbWUgPSBwYXJhbXMuYXR0YWNobWVudE5hbWVcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRJbnB1dCA9IHBhcmFtcy5hdHRhY2htZW50XG5cbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudE5hbWUgIT09IFwic3RyaW5nXCIgfHwgYXR0YWNobWVudE5hbWUubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgYXR0YWNobWVudE5hbWUuXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudElucHV0ID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCBhdHRhY2htZW50IGlucHV0LlwiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJhdHRhY2hcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLmF0dGFjaChhdHRhY2htZW50SW5wdXQpXG4gICAgICBjb25zdCBzZXJpYWxpemVkTW9kZWwgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG5cbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2VzcyhzZXJpYWxpemVkTW9kZWwpXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkb3dubG9hZFwiKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGFyYW1zID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKVxuICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50UGFyYW1zID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGF0dGFjaG1lbnRQYXJhbXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImRvd25sb2FkXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkb3dubG9hZGVkQXR0YWNobWVudCA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkuZG93bmxvYWQoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50SWQpXG5cbiAgICAgIGlmICghZG93bmxvYWRlZEF0dGFjaG1lbnQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkF0dGFjaG1lbnQgbm90IGZvdW5kLlwiLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGF0dGFjaG1lbnQ6IHtcbiAgICAgICAgICBieXRlU2l6ZTogZG93bmxvYWRlZEF0dGFjaG1lbnQuYnl0ZVNpemUoKSxcbiAgICAgICAgICBjb250ZW50QmFzZTY0OiBkb3dubG9hZGVkQXR0YWNobWVudC5jb250ZW50KCkudG9TdHJpbmcoXCJiYXNlNjRcIiksXG4gICAgICAgICAgY29udGVudFR5cGU6IGRvd25sb2FkZWRBdHRhY2htZW50LmNvbnRlbnRUeXBlKCksXG4gICAgICAgICAgZmlsZW5hbWU6IGRvd25sb2FkZWRBdHRhY2htZW50LmZpbGVuYW1lKCksXG4gICAgICAgICAgaWQ6IGRvd25sb2FkZWRBdHRhY2htZW50LmlkKCksXG4gICAgICAgICAgdXJsOiBkb3dubG9hZGVkQXR0YWNobWVudC51cmwoKVxuICAgICAgICB9LFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cmxcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBhcmFtcyA9IGZyb250ZW5kTW9kZWxBdHRhY2htZW50UGFyYW1zKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudFBhcmFtcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChhdHRhY2htZW50UGFyYW1zKVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJ1cmxcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVybCA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkudXJsKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudElkKVxuXG4gICAgICBpZiAoIXVybCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQXR0YWNobWVudCBVUkwgbm90IGF2YWlsYWJsZS5cIilcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgdXJsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJhdHRhY2htZW50TGlzdFwiKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGFyYW1zID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKVxuICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50UGFyYW1zID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGF0dGFjaG1lbnRQYXJhbXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImF0dGFjaG1lbnRMaXN0XCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkubGlzdE1ldGFkYXRhKClcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYXR0YWNobWVudHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWN0aW9uID09PSBcImZpbmRcIikge1xuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwiZmluZFwiLCBpZClcblxuICAgICAgaWYgKCFtb2RlbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGAke21vZGVsQ2xhc3MubmFtZX0gbm90IGZvdW5kLmAsIHtlcnJvclR5cGU6IFwicmVjb3JkX25vdF9mb3VuZFwifSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhbbW9kZWxdKVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKG1vZGVsLCBcImZpbmRcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgbXV0YXRpb25BdHRyaWJ1dGVzID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKG11dGF0aW9uQXR0cmlidXRlcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwidXBkYXRlXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCB1cGRhdGVkTW9kZWwgPSBhd2FpdCByZXNvdXJjZS51cGRhdGUobW9kZWwsIG11dGF0aW9uQXR0cmlidXRlcy5hdHRyaWJ1dGVzLCB7XG4gICAgICAgIGF0dGFjaG1lbnRzOiBtdXRhdGlvbkF0dHJpYnV0ZXMuYXR0YWNobWVudHMsXG4gICAgICAgIGNvbnRyb2xsZXI6IHRoaXMsXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IG11dGF0aW9uQXR0cmlidXRlcy5uZXN0ZWRBdHRyaWJ1dGVzXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKHVwZGF0ZWRNb2RlbCwgXCJ1cGRhdGVcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJkZXN0cm95XCIsIGlkKVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgfVxuXG4gICAgYXdhaXQgcmVzb3VyY2UuZGVzdHJveShtb2RlbClcblxuICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgYm9vdHN0cmFwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIGJvb3RzdHJhcCByZXNwb25zZSB3aXRoIG1hbmlmZXN0IGFuZCBzaWduZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY0Jvb3RzdHJhcCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBzeW5jTWFuaWZlc3QgPSBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50ID0gYXdhaXQgY3JlYXRlT2ZmbGluZUdyYW50RnJvbUJvb3RzdHJhcCh7XG4gICAgICBkZXZpY2VJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBEZXZpY2VJZChwYXJhbXMpLFxuICAgICAgZ3JhbnRJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBHcmFudElkKHBhcmFtcyksXG4gICAgICBncmFudFR0bE1zOiBjb25maWd1cmF0aW9uLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50VHRsTXMsXG4gICAgICBub3c6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwTm93KHBhcmFtcyksXG4gICAgICByZXNvdXJjZXM6IHN5bmNNYW5pZmVzdCxcbiAgICAgIHNjb3BlczogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBTY29wZXMocGFyYW1zKSxcbiAgICAgIHNpZ25pbmdLZXk6IGNvbmZpZ3VyYXRpb24uY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoKSxcbiAgICAgIHVzZXJJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBVc2VySWQoKVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIG9mZmxpbmVHcmFudCxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgc3luY01hbmlmZXN0XG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZGV2aWNlIGlkIGZvciBzeW5jIGJvb3RzdHJhcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXZpY2UgaWQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBEZXZpY2VJZChwYXJhbXMpIHtcbiAgICBpZiAodHlwZW9mIHBhcmFtcy5kZXZpY2VJZCA9PT0gXCJzdHJpbmdcIiAmJiBwYXJhbXMuZGV2aWNlSWQubGVuZ3RoID4gMCkgcmV0dXJuIHBhcmFtcy5kZXZpY2VJZFxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBib290c3RyYXAgZGV2aWNlSWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBncmFudCBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlIHwgdW5kZWZpbmVkPn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGV0ZXJtaW5pc3RpYyBncmFudCBpZCBmb3IgdGVzdHMsIGdlbmVyYXRlZCBpZCBvdGhlcndpc2UuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBHcmFudElkKHBhcmFtcykge1xuICAgIGlmICh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiAmJiB0eXBlb2YgcGFyYW1zLmdyYW50SWQgPT09IFwic3RyaW5nXCIpIHJldHVybiBwYXJhbXMuZ3JhbnRJZFxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGJvb3RzdHJhcCBpc3N1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBJc3N1ZSB0aW1lLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwTm93KHBhcmFtcykge1xuICAgIGlmICh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiAmJiB0eXBlb2YgcGFyYW1zLm5vdyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIG5ldyBEYXRlKHBhcmFtcy5ub3cpXG5cbiAgICByZXR1cm4gbmV3IERhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgYm9vdHN0cmFwIHNjb3Blcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gR3JhbnQgc2NvcGVzLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwU2NvcGVzKHBhcmFtcykge1xuICAgIGNvbnN0IHNjb3BlcyA9IHBhcmFtcy5zY29wZXNcblxuICAgIGlmIChzY29wZXMgJiYgdHlwZW9mIHNjb3BlcyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShzY29wZXMpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoc2NvcGVzKVxuICAgIH1cblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGN1cnJlbnQgdXNlciBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVXNlciBpZC5cbiAgICovXG4gIGZyb250ZW5kU3luY0Jvb3RzdHJhcFVzZXJJZCgpIHtcbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG4gICAgY29uc3QgY3VycmVudFVzZXIgPSBhYmlsaXR5Py5jdXJyZW50VXNlcigpXG5cbiAgICBpZiAodHlwZW9mIGN1cnJlbnRVc2VyID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBjdXJyZW50VXNlciA9PT0gXCJudW1iZXJcIikgcmV0dXJuIFN0cmluZyhjdXJyZW50VXNlcilcbiAgICBpZiAoY3VycmVudFVzZXIgJiYgdHlwZW9mIGN1cnJlbnRVc2VyID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjb25zdCB1c2VyUmVjb3JkID0gLyoqIEB0eXBlIHt7aWQ/OiBzdHJpbmcgfCBudW1iZXIgfCAoKCkgPT4gc3RyaW5nIHwgbnVtYmVyKX19ICovIChjdXJyZW50VXNlcilcbiAgICAgIGNvbnN0IGlkVmFsdWUgPSB0eXBlb2YgdXNlclJlY29yZC5pZCA9PT0gXCJmdW5jdGlvblwiID8gdXNlclJlY29yZC5pZCgpIDogdXNlclJlY29yZC5pZFxuXG4gICAgICBpZiAodHlwZW9mIGlkVmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGlkVmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiBTdHJpbmcoaWRWYWx1ZSlcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGJvb3RzdHJhcCBjdXJyZW50IHVzZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgcmVwbGF5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIHJlcGxheSByZXNwb25zZSB3aXRoIHBlci1tdXRhdGlvbiByZXN1bHRzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5KCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3Qgc2lnbmVkTXV0YXRpb25zID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlTaWduZWRNdXRhdGlvbnMocGFyYW1zKVxuICAgIGNvbnN0IHJlc3VsdHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzaWduZWRNdXRhdGlvbiBvZiBzaWduZWRNdXRhdGlvbnMpIHtcbiAgICAgIGxldCBpZGVtcG90ZW5jeUtleSA9IG51bGxcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXkgPSBtdXRhdGlvbklkZW1wb3RlbmN5S2V5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbikpXG4gICAgICAgIGNvbnN0IHtyZXNwb25zZSwgc2VydmVyQ2hhbmdlRmVlZEVycm9yLCBzZXJ2ZXJDaGFuZ2VGZWVkU3RhdHVzLCBzZXJ2ZXJTZXF1ZW5jZX0gPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9uKHNpZ25lZE11dGF0aW9uKVxuXG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgc2VydmVyQ2hhbmdlRmVlZEVycm9yLFxuICAgICAgICAgIHNlcnZlckNoYW5nZUZlZWRTdGF0dXMsXG4gICAgICAgICAgc2VydmVyU2VxdWVuY2UsXG4gICAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICAgIGFjdGlvbjogXCJmcm9udGVuZFN5bmNSZXBsYXlcIixcbiAgICAgICAgICBjb21tYW5kVHlwZTogc2lnbmVkTXV0YXRpb24gJiYgdHlwZW9mIHNpZ25lZE11dGF0aW9uID09PSBcIm9iamVjdFwiICYmIFwibXV0YXRpb25cIiBpbiBzaWduZWRNdXRhdGlvblxuICAgICAgICAgICAgPyAvKiogQHR5cGUge3ttdXRhdGlvbj86IHtvcGVyYXRpb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19fSAqLyAoc2lnbmVkTXV0YXRpb24pLm11dGF0aW9uPy5vcGVyYXRpb25cbiAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIG1vZGVsOiBzaWduZWRNdXRhdGlvbiAmJiB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gPT09IFwib2JqZWN0XCIgJiYgXCJtdXRhdGlvblwiIGluIHNpZ25lZE11dGF0aW9uXG4gICAgICAgICAgICA/IC8qKiBAdHlwZSB7e211dGF0aW9uPzoge21vZGVsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fX0gKi8gKHNpZ25lZE11dGF0aW9uKS5tdXRhdGlvbj8ubW9kZWxcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpZGVtcG90ZW5jeUtleSxcbiAgICAgICAgICByZXNwb25zZTogYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dCksXG4gICAgICAgICAgc3RhdHVzOiBcImVycm9yXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzaWduZWQgcmVwbGF5IG11dGF0aW9ucyBmcm9tIHJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2lnbmVkIG11dGF0aW9uIGVudmVsb3Blcy5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9ucyhwYXJhbXMpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJhbXMubXV0YXRpb25zKSkgcmV0dXJuIHBhcmFtcy5tdXRhdGlvbnNcbiAgICBpZiAocGFyYW1zLm11dGF0aW9uKSByZXR1cm4gW3BhcmFtcy5tdXRhdGlvbl1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIG9yIG11dGF0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGFuZCByZXBsYXlzIG9uZSBzaWduZWQgc3luYyBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2lnbmVkTXV0YXRpb24gLSBTaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtyZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzZXJ2ZXJDaGFuZ2VGZWVkRXJyb3I/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNlcnZlckNoYW5nZUZlZWRTdGF0dXM/OiBcImVycm9yXCIsIHNlcnZlclNlcXVlbmNlOiBudW1iZXIgfCBudWxsfT59IC0gRnJvbnRlbmQtbW9kZWwgY29tbWFuZCByZXNwb25zZSBhbmQgYXBwZW5kZWQgc2VydmVyIHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkTXV0YXRpb24oc2lnbmVkTXV0YXRpb24pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBzeW5jQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGJhY2tlbmRQdWJsaWNLZXkgPSBzeW5jQ29uZmlndXJhdGlvbi5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXlcblxuICAgIGlmICghYmFja2VuZFB1YmxpY0tleSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgaXMgcmVxdWlyZWQgZm9yIHN5bmMgcmVwbGF5XCIpXG5cbiAgICBsZXQgbXV0YXRpb25cblxuICAgIHRyeSB7XG4gICAgICBtdXRhdGlvbiA9IGF3YWl0IHZlcmlmeVNpZ25lZE11dGF0aW9uKHtcbiAgICAgICAgYmFja2VuZFB1YmxpY0tleSxcbiAgICAgICAgc2lnbmVkTXV0YXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbilcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksIGVycm9yKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bmNNYW5pZmVzdCA9IGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHMoY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSlcbiAgICBjb25zdCBzeW5jUmVzb3VyY2UgPSBzeW5jTWFuaWZlc3RbbXV0YXRpb24ubW9kZWxdXG5cbiAgICBpZiAoIXN5bmNSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIGlmICghc3luY1Jlc291cmNlLm9wZXJhdGlvbnMuaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBvcGVyYXRpb24gaXMgbm90IGVuYWJsZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cbiAgICBpZiAoc3luY1Jlc291cmNlLnBvbGljeUhhc2ggIT09IG11dGF0aW9uLnBvbGljeUhhc2gpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgcG9saWN5IGhhc2ggbWlzbWF0Y2ggZm9yICR7bXV0YXRpb24ubW9kZWx9YClcbiAgICB9XG5cbiAgICBjb25zdCBzaWduZWRPZmZsaW5lR3JhbnQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE9mZmxpbmVHcmFudChzaWduZWRNdXRhdGlvbilcbiAgICBjb25zdCBvZmZsaW5lR3JhbnQgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtcbiAgICAgIHNpZ25lZE9mZmxpbmVHcmFudCxcbiAgICAgIHNpZ25pbmdLZXlzOiBzeW5jQ29uZmlndXJhdGlvbi5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuICAgIH0pXG5cbiAgICB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZhbGlkYXRlT2ZmbGluZUdyYW50KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jUmVzb3VyY2V9KVxuXG4gICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZFBhcmFtcyhtdXRhdGlvbilcbiAgICBjb25zdCByZXBsYXlDb21tYW5kID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kRm9yTXV0YXRpb24obXV0YXRpb24pXG5cbiAgICBsZXQgcmVzcG9uc2VcblxuICAgIHRyeSB7XG4gICAgICByZXNwb25zZSA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbW1hbmRQYXJhbXMsIHRoaXMucmVzcG9uc2UoKSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZCgvKiogQHR5cGUge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9ICovIChtdXRhdGlvbi5vcGVyYXRpb24pKSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDdXN0b21Db21tYW5kUGF5bG9hZCh7bXV0YXRpb24sIHJlcGxheUNvbW1hbmR9KSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgYWN0aW9uOiBcImZyb250ZW5kU3luY1JlcGxheVwiLFxuICAgICAgICBjb21tYW5kVHlwZTogLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlcGxheUNvbW1hbmQuY29tbWFuZFR5cGUpLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbW9kZWw6IG11dGF0aW9uLm1vZGVsXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVzcG9uc2U6IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLFxuICAgICAgICBzZXJ2ZXJTZXF1ZW5jZTogbnVsbFxuICAgICAgfVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jQXBwZW5kU2VydmVyQ2hhbmdlKHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IG11dGF0aW9uSWRlbXBvdGVuY3lLZXkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gKi8gKHNpZ25lZE11dGF0aW9uKSksXG4gICAgICAgIG11dGF0aW9uLFxuICAgICAgICBvZmZsaW5lR3JhbnQsXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4ge3Jlc3BvbnNlLCBzZXJ2ZXJTZXF1ZW5jZX1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICBhY3Rpb246IFwiZnJvbnRlbmRTeW5jUmVwbGF5XCIsXG4gICAgICAgIGNvbW1hbmRUeXBlOiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVwbGF5Q29tbWFuZC5jb21tYW5kVHlwZSksXG4gICAgICAgIGVycm9yLFxuICAgICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWxcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICByZXNwb25zZSxcbiAgICAgICAgc2VydmVyQ2hhbmdlRmVlZEVycm9yOiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSxcbiAgICAgICAgc2VydmVyQ2hhbmdlRmVlZFN0YXR1czogXCJlcnJvclwiLFxuICAgICAgICBzZXJ2ZXJTZXF1ZW5jZTogbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2lnbmVkIG9mZmxpbmUgZ3JhbnQgY2FycmllZCBieSBhIHJlcGxheSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzaWduZWRNdXRhdGlvbiAtIFNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkT2ZmbGluZUdyYW50KHNpZ25lZE11dGF0aW9uKSB7XG4gICAgaWYgKCFzaWduZWRNdXRhdGlvbiB8fCB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzaWduZWRNdXRhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIkV4cGVjdGVkIHN5bmMgcmVwbGF5IHNpZ25lZCBvZmZsaW5lIGdyYW50XCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc2lnbmVkTXV0YXRpb25SZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNpZ25lZE11dGF0aW9uKVxuICAgIGNvbnN0IHNpZ25lZE9mZmxpbmVHcmFudCA9IHNpZ25lZE11dGF0aW9uUmVjb3JkLnNpZ25lZE9mZmxpbmVHcmFudCB8fCBzaWduZWRNdXRhdGlvblJlY29yZC5vZmZsaW5lR3JhbnQgfHwgc2lnbmVkTXV0YXRpb25SZWNvcmQuc2lnbmVkR3JhbnRcblxuICAgIGlmICghc2lnbmVkT2ZmbGluZUdyYW50KSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJFeHBlY3RlZCBzeW5jIHJlcGxheSBzaWduZWQgb2ZmbGluZSBncmFudFwiKVxuXG4gICAgcmV0dXJuIHNpZ25lZE9mZmxpbmVHcmFudFxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGEgc3luYyByZXBsYXkgc2lnbmVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnNpZ25lZE9mZmxpbmVHcmFudCAtIFNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXlbXX0gYXJncy5zaWduaW5nS2V5cyAtIEF2YWlsYWJsZSBzaWduaW5nIGtleXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudD59IC0gVmVyaWZpZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtzaWduZWRPZmZsaW5lR3JhbnQsIHNpZ25pbmdLZXlzfSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdmVyaWZ5T2ZmbGluZUdyYW50KHtcbiAgICAgICAgbm93OiBuZXcgRGF0ZSgpLFxuICAgICAgICBzaWduZWRHcmFudDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5TaWduZWRPZmZsaW5lR3JhbnR9ICovIChzaWduZWRPZmZsaW5lR3JhbnQpLFxuICAgICAgICBzaWduaW5nS2V5c1xuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGF0IGEgdmVyaWZpZWQgb2ZmbGluZSBncmFudCBhdXRob3JpemVzIGEgcmVwbGF5ZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50fSBhcmdzLm9mZmxpbmVHcmFudCAtIFZlcmlmaWVkIGdyYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5zeW5jUmVzb3VyY2UgLSBDdXJyZW50IHN5bmMgcmVzb3VyY2UgZW50cnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIFRocm93cyB3aGVuIHVuYXV0aG9yaXplZC5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVZhbGlkYXRlT2ZmbGluZUdyYW50KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jUmVzb3VyY2V9KSB7XG4gICAgaWYgKG9mZmxpbmVHcmFudC5ncmFudElkICE9PSBtdXRhdGlvbi5vZmZsaW5lR3JhbnRJZCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwiU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cbiAgICBpZiAob2ZmbGluZUdyYW50LmRldmljZUlkICE9PSBtdXRhdGlvbi5hY3RvckRldmljZUlkKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IGRldmljZSBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cbiAgICBpZiAob2ZmbGluZUdyYW50LnVzZXJJZCAhPT0gbXV0YXRpb24uYWN0b3JVc2VySWQpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIlN5bmMgcmVwbGF5IG9mZmxpbmUgZ3JhbnQgdXNlciBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cblxuICAgIGNvbnN0IGdyYW50UmVzb3VyY2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKG9mZmxpbmVHcmFudC5yZXNvdXJjZXNbbXV0YXRpb24ubW9kZWxdKVxuICAgIGNvbnN0IGdyYW50T3BlcmF0aW9ucyA9IEFycmF5LmlzQXJyYXkoZ3JhbnRSZXNvdXJjZT8ub3BlcmF0aW9ucykgPyBncmFudFJlc291cmNlLm9wZXJhdGlvbnMgOiBbXVxuICAgIGNvbnN0IGdyYW50UG9saWN5SGFzaCA9IGdyYW50UmVzb3VyY2U/LnBvbGljeUhhc2hcblxuICAgIGlmICghZ3JhbnRSZXNvdXJjZSB8fCBncmFudFJlc291cmNlLmVuYWJsZWQgIT09IHRydWUpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIGlmICghZ3JhbnRPcGVyYXRpb25zLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH06ICR7bXV0YXRpb24ub3BlcmF0aW9ufWApXG4gICAgfVxuICAgIGlmIChncmFudFBvbGljeUhhc2ggIT09IG11dGF0aW9uLnBvbGljeUhhc2ggfHwgZ3JhbnRQb2xpY3lIYXNoICE9PSBzeW5jUmVzb3VyY2UucG9saWN5SGFzaCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHBvbGljeSBoYXNoIG1pc21hdGNoIGZvciAke211dGF0aW9uLm1vZGVsfWApXG4gICAgfVxuICAgIGlmICghb2ZmbGluZUdyYW50LnNjb3BlcyB8fCB0eXBlb2Ygb2ZmbGluZUdyYW50LnNjb3BlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudC5zY29wZXMpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHNjb3BlcyBhcmUgaW52YWxpZFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIGEgdmVyaWZpZWQgY3VzdG9tIHN5bmMgbXV0YXRpb24gdGhyb3VnaCB0aGUgcmVzb3VyY2UgY29tbWFuZCBBUEkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7e2NvbW1hbmRUeXBlOiBzdHJpbmcsIG1ldGhvZE5hbWU/OiBzdHJpbmcsIHNjb3BlPzogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifX0gYXJncy5yZXBsYXlDb21tYW5kIC0gUmVzb2x2ZWQgcmVwbGF5IGNvbW1hbmQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQ29tbWFuZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5Q3VzdG9tQ29tbWFuZFBheWxvYWQoe211dGF0aW9uLCByZXBsYXlDb21tYW5kfSkge1xuICAgIGlmICh0eXBlb2YgcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lICE9PSBcInN0cmluZ1wiIHx8IHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IGNvbW1hbmQgaXMgbm90IHJlZ2lzdGVyZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cblxuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICAubWFwKChiYWNrZW5kUHJvamVjdCkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IG11dGF0aW9uLm1vZGVsfSkpXG4gICAgICAuZmluZCgocmVzb3VyY2VDb25maWd1cmF0aW9uKSA9PiByZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSBuZXcgZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eTogdGhpcy5jdXJyZW50QWJpbGl0eSgpLFxuICAgICAgY29udHJvbGxlcjogdGhpcyxcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgLi4uKHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0Q29udGV4dCgpIHx8IHt9KSxcbiAgICAgICAgcGFyYW1zOiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0KClcbiAgICAgIH0sXG4gICAgICBsb2NhbHM6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKSxcbiAgICAgIG1vZGVsTmFtZTogZnJvbnRlbmRNb2RlbFJlc291cmNlLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNvbW1hbmQgPSByZXNvdXJjZS5yZXNvdXJjZU1ldGhvZChyZXBsYXlDb21tYW5kLm1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIWNvbW1hbmQpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYE1pc3NpbmcgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgJyR7cmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lfScuYClcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kQXJndW1lbnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtdXRhdGlvbi5wYXlsb2FkICYmIHR5cGVvZiBtdXRhdGlvbi5wYXlsb2FkID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KG11dGF0aW9uLnBheWxvYWQpID8gbXV0YXRpb24ucGF5bG9hZCA6IHt9KVxuICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IGNvbW1hbmQubWV0aG9kLmNhbGwoY29tbWFuZC5yZXNvdXJjZSwgY29tbWFuZEFyZ3VtZW50cylcblxuICAgIGlmICghcmVzcG9uc2VQYXlsb2FkIHx8IHR5cGVvZiByZXNwb25zZVBheWxvYWQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChcbiAgICAgIGF3YWl0IHRoaXMuYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKFxuICAgICAgICByZXNwb25zZVBheWxvYWQsXG4gICAgICAgIC8qKiBAdHlwZSB7e3NlcmlhbGl6ZTogKG1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWN0aW9uOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19ICovIChjb21tYW5kLnJlc291cmNlKSxcbiAgICAgICAgcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lXG4gICAgICApXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBmcm9udGVuZC1tb2RlbCBjb21tYW5kIHBhcmFtcyBmb3IgYSB2ZXJpZmllZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IG11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gRnJvbnRlbmQtbW9kZWwgY29tbWFuZCBwYXJhbXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kUGFyYW1zKG11dGF0aW9uKSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IG11dGF0aW9uLnBheWxvYWQgJiYgdHlwZW9mIG11dGF0aW9uLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkobXV0YXRpb24ucGF5bG9hZCkgPyBtdXRhdGlvbi5wYXlsb2FkIDoge31cbiAgICBjb25zdCB7YXR0cmlidXRlcywgcHJpbWFyeUtleVZhbHVlfSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEF0dHJpYnV0ZXMobXV0YXRpb24pXG4gICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe1xuICAgICAgLi4ucGF5bG9hZCxcbiAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWxcbiAgICB9KVxuXG4gICAgaWYgKFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl0uaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgaWYgKG11dGF0aW9uLm9wZXJhdGlvbiAhPT0gXCJjcmVhdGVcIikge1xuICAgICAgICBjb25zdCBpZCA9IGNvbW1hbmRQYXJhbXMuaWQgfHwgY29tbWFuZFBhcmFtcy5yZWNvcmRJZCB8fCBwcmltYXJ5S2V5VmFsdWVcblxuICAgICAgICBpZiAodHlwZW9mIGlkICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSAke211dGF0aW9uLm9wZXJhdGlvbn0gcmVxdWlyZXMgYW4gaWRgKVxuXG4gICAgICAgIGNvbW1hbmRQYXJhbXMuaWQgPSBpZFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29tbWFuZFBhcmFtc1xuICAgIH1cblxuICAgIGNvbnN0IHJlcGxheUNvbW1hbmQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRGb3JNdXRhdGlvbihtdXRhdGlvbilcblxuICAgIGNvbW1hbmRQYXJhbXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRNZXRob2ROYW1lID0gcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lXG4gICAgY29tbWFuZFBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFNjb3BlID0gcmVwbGF5Q29tbWFuZC5zY29wZVxuXG4gICAgaWYgKHJlcGxheUNvbW1hbmQuc2NvcGUgPT09IFwibWVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGlkID0gY29tbWFuZFBhcmFtcy5pZCB8fCBjb21tYW5kUGFyYW1zLnJlY29yZElkIHx8IHByaW1hcnlLZXlWYWx1ZVxuXG4gICAgICBpZiAodHlwZW9mIGlkICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSAke211dGF0aW9uLm9wZXJhdGlvbn0gcmVxdWlyZXMgYW4gaWRgKVxuXG4gICAgICBjb21tYW5kUGFyYW1zLmlkID0gaWRcbiAgICB9XG5cbiAgICByZXR1cm4gY29tbWFuZFBhcmFtc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBmcm9udGVuZC1tb2RlbCBjb21tYW5kIHVzZWQgZm9yIGEgdmVyaWZpZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBtdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2NvbW1hbmRUeXBlOiBzdHJpbmcsIG1ldGhvZE5hbWU/OiBzdHJpbmcsIHNjb3BlPzogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifX0gLSBDb21tYW5kIG1ldGFkYXRhLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEZvck11dGF0aW9uKG11dGF0aW9uKSB7XG4gICAgaWYgKFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl0uaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuIHtjb21tYW5kVHlwZTogbXV0YXRpb24ub3BlcmF0aW9ufVxuICAgIH1cblxuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICAubWFwKChiYWNrZW5kUHJvamVjdCkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IG11dGF0aW9uLm1vZGVsfSkpXG4gICAgICAuZmluZCgocmVzb3VyY2VDb25maWd1cmF0aW9uKSA9PiByZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSB0eXBlb2YgbXV0YXRpb24uY29tbWFuZCA9PT0gXCJzdHJpbmdcIiAmJiBtdXRhdGlvbi5jb21tYW5kLmxlbmd0aCA+IDAgPyBtdXRhdGlvbi5jb21tYW5kIDogbXV0YXRpb24ub3BlcmF0aW9uXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvblxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29sbGVjdGlvbkNvbW1hbmRzLCBjb21tYW5kTmFtZSkpIHtcbiAgICAgIHJldHVybiB7Y29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc2NvcGU6IFwiY29sbGVjdGlvblwifVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocmVzb3VyY2VDb25maWd1cmF0aW9uLm1lbWJlckNvbW1hbmRzLCBjb21tYW5kTmFtZSkpIHtcbiAgICAgIHJldHVybiB7Y29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc2NvcGU6IFwibWVtYmVyXCJ9XG4gICAgfVxuXG4gICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBjb21tYW5kIGlzIG5vdCByZWdpc3RlcmVkIGZvciAke211dGF0aW9uLm1vZGVsfTogJHtjb21tYW5kTmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGNvbW1hbmQgYXR0cmlidXRlcyBhbmQgcHJpbWFyeSBrZXkgZnJvbSBhIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBWZXJpZmllZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcHJpbWFyeUtleVZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCB1bmRlZmluZWR9Pn0gLSBDb21tYW5kIGF0dHJpYnV0ZXMgYW5kIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEF0dHJpYnV0ZXMobXV0YXRpb24pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7Li4uKG11dGF0aW9uLmF0dHJpYnV0ZXMgfHwge30pfSlcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgICAgLm1hcCgoYmFja2VuZFByb2plY3QpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxOYW1lOiBtdXRhdGlvbi5tb2RlbH0pKVxuICAgICAgLmZpbmQoKHJlc291cmNlQ29uZmlndXJhdGlvbikgPT4gcmVzb3VyY2VDb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVybiB7YXR0cmlidXRlcywgcHJpbWFyeUtleVZhbHVlOiB1bmRlZmluZWR9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSA9PT0gXCJzdHJpbmdcIiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSA6IFwiaWRcIlxuICAgIGNvbnN0IHByaW1hcnlLZXlBdHRyaWJ1dGUgPSBhdHRyaWJ1dGVzW3ByaW1hcnlLZXldXG4gICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gdHlwZW9mIHByaW1hcnlLZXlBdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHByaW1hcnlLZXlBdHRyaWJ1dGUgPT09IFwibnVtYmVyXCIgPyBwcmltYXJ5S2V5QXR0cmlidXRlIDogdW5kZWZpbmVkXG5cbiAgICBpZiAocHJpbWFyeUtleVZhbHVlICE9PSB1bmRlZmluZWQgJiYgbXV0YXRpb24ub3BlcmF0aW9uICE9PSBcImNyZWF0ZVwiKSBkZWxldGUgYXR0cmlidXRlc1twcmltYXJ5S2V5XVxuXG4gICAgcmV0dXJuIHthdHRyaWJ1dGVzLCBwcmltYXJ5S2V5VmFsdWV9XG4gIH1cblxuICAvKipcbiAgICogQXBwZW5kcyBhIHN1Y2Nlc3NmdWxseSByZXBsYXllZCBtdXRhdGlvbiB0byB0aGUgc2VydmVyIGNoYW5nZSBmZWVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmlkZW1wb3RlbmN5S2V5IC0gTXV0YXRpb24gaWRlbXBvdGVuY3kga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50fSBhcmdzLm9mZmxpbmVHcmFudCAtIFZlcmlmaWVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJlc3BvbnNlIC0gUmVwbGF5IGNvbW1hbmQgcmVzcG9uc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIEFzc2lnbmVkIHNlcnZlciBzZXF1ZW5jZSwgb3IgbnVsbCB3aGVuIG5vIGNoYW5nZSB3YXMgYXBwZW5kZWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNBcHBlbmRTZXJ2ZXJDaGFuZ2Uoe2lkZW1wb3RlbmN5S2V5LCBtdXRhdGlvbiwgb2ZmbGluZUdyYW50LCByZXNwb25zZX0pIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSBcInN1Y2Nlc3NcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHN0b3JlID0gc2VydmVyQ2hhbmdlRmVlZFN0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICBjb25zdCByZXNwb25zZVN5bmNDaGFuZ2VzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5zeW5jQ2hhbmdlcykgPyByZXNwb25zZS5zeW5jQ2hhbmdlcyA6IFtdXG4gICAgY29uc3Qgc3luY0NoYW5nZXMgPSByZXNwb25zZVN5bmNDaGFuZ2VzLmxlbmd0aCA+IDAgPyByZXNwb25zZVN5bmNDaGFuZ2VzIDogW3tcbiAgICAgIGF0dHJpYnV0ZXM6IG11dGF0aW9uLmF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWwsXG4gICAgICBvcGVyYXRpb246IG11dGF0aW9uLm9wZXJhdGlvbixcbiAgICAgIHBheWxvYWQ6IG11dGF0aW9uLnBheWxvYWRcbiAgICB9XVxuICAgIGxldCBzZXJ2ZXJTZXF1ZW5jZSA9IC8qKiBAdHlwZSB7bnVtYmVyIHwgbnVsbH0gKi8gKG51bGwpXG5cbiAgICBmb3IgKGNvbnN0IHN5bmNDaGFuZ2Ugb2Ygc3luY0NoYW5nZXMpIHtcbiAgICAgIGlmICghc3luY0NoYW5nZSB8fCB0eXBlb2Ygc3luY0NoYW5nZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHN5bmNDaGFuZ2UpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjaGFuZ2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN5bmNDaGFuZ2UpXG4gICAgICBjb25zdCBwYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjaGFuZ2UucGF5bG9hZCAmJiB0eXBlb2YgY2hhbmdlLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoY2hhbmdlLnBheWxvYWQpID8gY2hhbmdlLnBheWxvYWQgOiB7fSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNoYW5nZS5hdHRyaWJ1dGVzICYmIHR5cGVvZiBjaGFuZ2UuYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjaGFuZ2UuYXR0cmlidXRlcykgPyBjaGFuZ2UuYXR0cmlidXRlcyA6IHt9KVxuICAgICAgY29uc3QgbW9kZWwgPSB0eXBlb2YgY2hhbmdlLm1vZGVsID09PSBcInN0cmluZ1wiICYmIGNoYW5nZS5tb2RlbC5sZW5ndGggPiAwID8gY2hhbmdlLm1vZGVsIDogbXV0YXRpb24ubW9kZWxcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IHR5cGVvZiBjaGFuZ2Uub3BlcmF0aW9uID09PSBcInN0cmluZ1wiICYmIGNoYW5nZS5vcGVyYXRpb24ubGVuZ3RoID4gMCA/IGNoYW5nZS5vcGVyYXRpb24gOiBtdXRhdGlvbi5vcGVyYXRpb25cbiAgICAgIGNvbnN0IHJhd1JlY29yZElkID0gY2hhbmdlLnJlY29yZElkID8/IHBheWxvYWQuaWQgPz8gcGF5bG9hZC5yZWNvcmRJZCA/PyBhdHRyaWJ1dGVzLmlkID8/IG51bGxcbiAgICAgIGNvbnN0IHJlY29yZElkID0gcmF3UmVjb3JkSWQgPT09IG51bGwgfHwgcmF3UmVjb3JkSWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocmF3UmVjb3JkSWQpXG4gICAgICBjb25zdCBhcHBlbmRlZENoYW5nZSA9IGF3YWl0IHN0b3JlLmFwcGVuZCh7XG4gICAgICAgIGFjdG9yRGV2aWNlSWQ6IG11dGF0aW9uLmFjdG9yRGV2aWNlSWQsXG4gICAgICAgIGFjdG9yVXNlcklkOiBtdXRhdGlvbi5hY3RvclVzZXJJZCxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHJlY29yZElkLFxuICAgICAgICByZXNwb25zZSxcbiAgICAgICAgc2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXNcbiAgICAgIH0pXG5cbiAgICAgIHNlcnZlclNlcXVlbmNlID0gYXBwZW5kZWRDaGFuZ2Uuc2VydmVyU2VxdWVuY2VcbiAgICB9XG5cbiAgICByZXR1cm4gc2VydmVyU2VxdWVuY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyB0aGUgc2lnbmVkIG9mZmxpbmUgZ3JhbnQgdXNlZCB0byBzY29wZSBzeW5jIHJlYWQgZW5kcG9pbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudD59IC0gVmVyaWZpZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcXVlc3RWZXJpZmllZE9mZmxpbmVHcmFudChwYXJhbXMpIHtcbiAgICBjb25zdCBzaWduZWRPZmZsaW5lR3JhbnQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE9mZmxpbmVHcmFudChwYXJhbXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlWZXJpZmllZE9mZmxpbmVHcmFudCh7XG4gICAgICBzaWduZWRPZmZsaW5lR3JhbnQsXG4gICAgICBzaWduaW5nS2V5czogdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBzeW5jIGNoYW5nZSBmZWVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIGNoYW5nZS1mZWVkIHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHRoaXMucGFyYW1zKCkpKVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVxdWVzdFZlcmlmaWVkT2ZmbGluZUdyYW50KHBhcmFtcylcbiAgICBjb25zdCBhZnRlclNlcXVlbmNlID0gdGhpcy5mcm9udGVuZFN5bmNDaGFuZ2VGZWVkQWZ0ZXJTZXF1ZW5jZShwYXJhbXMpXG4gICAgY29uc3Qgc3RvcmUgPSBzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5mcm9udGVuZFN5bmNDaGFuZ2VGZWVkTGltaXQocGFyYW1zKVxuICAgIGNvbnN0IGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSA9IGF3YWl0IHN0b3JlLmxhdGVzdFNlcXVlbmNlKClcbiAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZSA9IHRoaXMuZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZFVwVG9TZXF1ZW5jZShwYXJhbXMsIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSlcbiAgICBjb25zdCBwYWdlID0gYXdhaXQgc3RvcmUuY2hhbmdlc0FmdGVyKHthZnRlclNlcXVlbmNlLCBsaW1pdCwgc2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXMsIHVwVG9TZXF1ZW5jZTogc2VydmVyU2VxdWVuY2V9KVxuXG4gICAgaWYgKHBhZ2Uuc25hcHNob3RSZXF1aXJlZCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgICAgY2hhbmdlczogW10sXG4gICAgICAgICAgb2xkZXN0U2VxdWVuY2U6IHBhZ2Uub2xkZXN0U2VxdWVuY2UsXG4gICAgICAgICAgcmVxdWVzdGVkQWZ0ZXJTZXF1ZW5jZTogYWZ0ZXJTZXF1ZW5jZSxcbiAgICAgICAgICBzZXJ2ZXJTZXF1ZW5jZSxcbiAgICAgICAgICBzbmFwc2hvdDogYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzLCBzZXJ2ZXJTZXF1ZW5jZX0pLFxuICAgICAgICAgIHN0YXR1czogXCJzbmFwc2hvdF9yZXF1aXJlZFwiXG4gICAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2hhbmdlcyA9IHBhZ2UuY2hhbmdlc1xuICAgIGNvbnN0IGluY2x1ZGVTbmFwc2hvdCA9IHBhcmFtcy5zbmFwc2hvdCA9PT0gdHJ1ZSB8fCBwYXJhbXMuaW5jbHVkZVNuYXBzaG90ID09PSB0cnVlIHx8IGFmdGVyU2VxdWVuY2UgPT09IDBcbiAgICBjb25zdCBzbmFwc2hvdCA9IGluY2x1ZGVTbmFwc2hvdCA/IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jU25hcHNob3RQYXlsb2FkKHtzY29wZTogb2ZmbGluZUdyYW50LnNjb3Blcywgc2VydmVyU2VxdWVuY2V9KSA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3QgcGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe1xuICAgICAgY2hhbmdlcyxcbiAgICAgIGhhc01vcmU6IHBhZ2UuaGFzTW9yZSxcbiAgICAgIG5leHRTZXF1ZW5jZTogcGFnZS5uZXh0U2VxdWVuY2UsXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZSxcbiAgICAgIHN0YXR1czogXCJzdWNjZXNzXCIsXG4gICAgICB1cFRvU2VxdWVuY2U6IHBhZ2UudXBUb1NlcXVlbmNlXG4gICAgfSlcblxuICAgIGlmIChzbmFwc2hvdCkgcGF5bG9hZC5zbmFwc2hvdCA9IHNuYXBzaG90XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc3luYyBjaGFuZ2UtZmVlZCBjdXJzb3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBFeGNsdXNpdmUgbG93ZXItYm91bmQgc2VxdWVuY2UuXG4gICAqL1xuICBmcm9udGVuZFN5bmNDaGFuZ2VGZWVkQWZ0ZXJTZXF1ZW5jZShwYXJhbXMpIHtcbiAgICBjb25zdCBhZnRlclNlcXVlbmNlID0gcGFyYW1zLmFmdGVyU2VxdWVuY2UgPz8gcGFyYW1zLmN1cnNvciA/PyAwXG5cbiAgICBpZiAodHlwZW9mIGFmdGVyU2VxdWVuY2UgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcihhZnRlclNlcXVlbmNlKSAmJiBhZnRlclNlcXVlbmNlID49IDApIHJldHVybiBhZnRlclNlcXVlbmNlXG4gICAgaWYgKHR5cGVvZiBhZnRlclNlcXVlbmNlID09PSBcInN0cmluZ1wiICYmIC9eXFxkKyQvLnRlc3QoYWZ0ZXJTZXF1ZW5jZSkpIHJldHVybiBOdW1iZXIoYWZ0ZXJTZXF1ZW5jZSlcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgY2hhbmdlLWZlZWQgYWZ0ZXJTZXF1ZW5jZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgY2hhbmdlLWZlZWQgcGFnZSBsaW1pdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFBhZ2UgbGltaXQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNDaGFuZ2VGZWVkTGltaXQocGFyYW1zKSB7XG4gICAgY29uc3QgbGltaXQgPSBwYXJhbXMubGltaXQgPz8gcGFyYW1zLnBhZ2VTaXplID8/IDEwMFxuXG4gICAgaWYgKHR5cGVvZiBsaW1pdCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKGxpbWl0KSAmJiBsaW1pdCA+IDApIHJldHVybiBsaW1pdFxuICAgIGlmICh0eXBlb2YgbGltaXQgPT09IFwic3RyaW5nXCIgJiYgL15cXGQrJC8udGVzdChsaW1pdCkpIHJldHVybiBOdW1iZXIobGltaXQpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGNoYW5nZS1mZWVkIHBvc2l0aXZlIGxpbWl0XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc3luYyBjaGFuZ2UtZmVlZCBzdGFibGUgaGlnaC13YXRlciBtYXJrLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjdXJyZW50U2VydmVyU2VxdWVuY2UgLSBDdXJyZW50IGxhdGVzdCBzZXJ2ZXIgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gSW5jbHVzaXZlIHVwcGVyLWJvdW5kIHNlcXVlbmNlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZFVwVG9TZXF1ZW5jZShwYXJhbXMsIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSkge1xuICAgIGNvbnN0IHVwVG9TZXF1ZW5jZSA9IHBhcmFtcy51cFRvU2VxdWVuY2UgPz8gcGFyYW1zLnNlcnZlclNlcXVlbmNlID8/IGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZVxuXG4gICAgaWYgKHR5cGVvZiB1cFRvU2VxdWVuY2UgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcih1cFRvU2VxdWVuY2UpICYmIHVwVG9TZXF1ZW5jZSA+PSAwKSByZXR1cm4gTWF0aC5taW4odXBUb1NlcXVlbmNlLCBjdXJyZW50U2VydmVyU2VxdWVuY2UpXG4gICAgaWYgKHR5cGVvZiB1cFRvU2VxdWVuY2UgPT09IFwic3RyaW5nXCIgJiYgL15cXGQrJC8udGVzdCh1cFRvU2VxdWVuY2UpKSByZXR1cm4gTWF0aC5taW4oTnVtYmVyKHVwVG9TZXF1ZW5jZSksIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSlcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgY2hhbmdlLWZlZWQgdXBUb1NlcXVlbmNlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBzeW5jIHNuYXBzaG90IGVuZHBvaW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIHNuYXBzaG90IHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jU25hcHNob3QoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCBvZmZsaW5lR3JhbnQgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcXVlc3RWZXJpZmllZE9mZmxpbmVHcmFudChwYXJhbXMpXG4gICAgY29uc3Qgc3RvcmUgPSBzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IHNlcnZlclNlcXVlbmNlID0gYXdhaXQgc3RvcmUubGF0ZXN0U2VxdWVuY2UoKVxuICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzLCBzZXJ2ZXJTZXF1ZW5jZX0pXG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIHNuYXBzaG90LFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc25hcHNob3Qgb2Ygc3luYy1lbmFibGVkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcyBhdCBhIHN0YWJsZSBzZXJ2ZXIgc2VxdWVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5zZXJ2ZXJTZXF1ZW5jZSAtIFNuYXBzaG90IHNlcXVlbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Muc2NvcGVdIC0gQ2FsbGVyIHN5bmMgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtyZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2VydmVyU2VxdWVuY2U6IG51bWJlcn0+fSAtIFNuYXBzaG90IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlLCBzZXJ2ZXJTZXF1ZW5jZX0pIHtcbiAgICBjb25zdCBzeW5jTWFuaWZlc3QgPSBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpKVxuICAgIGNvbnN0IHJlc291cmNlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe30pXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhzeW5jTWFuaWZlc3QpLnNvcnQoKSkge1xuICAgICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IHsuLi4oc2NvcGUgfHwge30pLCBtb2RlbDogbW9kZWxOYW1lfVxuXG4gICAgICByZXNvdXJjZXNbbW9kZWxOYW1lXSA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbW1hbmRQYXJhbXMsIHRoaXMucmVzcG9uc2UoKSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZChcImluZGV4XCIpIHx8IHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkFjdGlvbiBoYWx0ZWQgYnkgYmVmb3JlQWN0aW9uLlwiKVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4ge3Jlc291cmNlcywgc2VydmVyU2VxdWVuY2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhcGkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUEkgYWN0aW9uIHdpdGggYmF0Y2ggc3VwcG9ydC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXBpKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3QgcmVxdWVzdHMgPSBBcnJheS5pc0FycmF5KHBhcmFtcy5yZXF1ZXN0cykgPyBwYXJhbXMucmVxdWVzdHMgOiBbcGFyYW1zXVxuICAgIC8qKlxuICAgICAqIFJlc3BvbnNlcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCByZXNwb25zZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByZXF1ZXN0RW50cnkgb2YgcmVxdWVzdHMpIHtcbiAgICAgIGNvbnN0IGNvbW1hbmRUeXBlID0gcmVxdWVzdEVudHJ5Py5jb21tYW5kVHlwZVxuICAgICAgY29uc3QgY3VzdG9tUGF0aCA9IHJlcXVlc3RFbnRyeT8uY3VzdG9tUGF0aFxuICAgICAgY29uc3QgbW9kZWwgPSByZXF1ZXN0RW50cnk/Lm1vZGVsXG4gICAgICBjb25zdCBwYXlsb2FkID0gcmVxdWVzdEVudHJ5Py5wYXlsb2FkXG4gICAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0RW50cnk/LnJlcXVlc3RJZFxuXG4gICAgICBpZiAodHlwZW9mIG1vZGVsICE9PSBcInN0cmluZ1wiIHx8IG1vZGVsLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgcmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXNwb25zZTogdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgcmVxdWVzdCBtb2RlbC5cIilcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgaXNCdWlsdEluQ29tbWFuZCA9IFtcImluZGV4XCIsIFwiZmluZFwiLCBcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIiwgXCJhdHRhY2hcIiwgXCJkb3dubG9hZFwiLCBcInVybFwiLCBcImF0dGFjaG1lbnRMaXN0XCJdLmluY2x1ZGVzKGNvbW1hbmRUeXBlKVxuXG4gICAgICBpZiAoIWlzQnVpbHRJbkNvbW1hbmQgJiYgKHR5cGVvZiBjdXN0b21QYXRoICE9PSBcInN0cmluZ1wiIHx8ICFjdXN0b21QYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgICByZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHJlc3BvbnNlOiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCByZXF1ZXN0IGN1c3RvbVBhdGguXCIpXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0RW50cnk/LnJlcXVlc3RDb250ZXh0KVxuICAgICAgICBsZXQgcmVzcG9uc2VQYXlsb2FkXG5cbiAgICAgICAgaWYgKGlzQnVpbHRJbkNvbW1hbmQpIHtcbiAgICAgICAgICBjb25zdCBjb21tYW5kUGFyYW1zID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgLi4uKHBheWxvYWQgJiYgdHlwZW9mIHBheWxvYWQgPT09IFwib2JqZWN0XCIgPyBwYXlsb2FkIDoge30pLFxuICAgICAgICAgICAgICBtb2RlbFxuICAgICAgICAgICAgfVxuICAgICAgICAgIClcblxuICAgICAgICAgIHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChjb21tYW5kUGFyYW1zLCB0aGlzLnJlc3BvbnNlKCksIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbW1hbmRQYXlsb2FkKGNvbW1hbmRUeXBlKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRBcGlDdXN0b21Db21tYW5kUGF5bG9hZCh7XG4gICAgICAgICAgICBjdXN0b21QYXRoLFxuICAgICAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgICAgIHJlcXVlc3RDb250ZXh0XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVzcG9uc2U6IHJlc3BvbnNlUGF5bG9hZCB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgICBhY3Rpb246IFwiZnJvbnRlbmRBcGlcIixcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICBtb2RlbCxcbiAgICAgICAgICByZXF1ZXN0SWRcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgICByZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHJlc3BvbnNlOiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHtcbiAgICAgICAgcmVzcG9uc2VzLFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRGlzcGF0Y2hlcyBhIGN1c3RvbSBmcm9udGVuZC1tb2RlbCBjb21tYW5kIHRocm91Z2ggdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW5kcG9pbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jdXN0b21QYXRoIC0gQ3VzdG9tIGJhY2tlbmQgcm91dGUgcGF0aC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wYXlsb2FkIC0gUmVxdWVzdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gYXJncy5yZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHJlbW90ZSByZXF1ZXN0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGFyc2VkIEpTT04gcmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXBpQ3VzdG9tQ29tbWFuZFBheWxvYWQoe2N1c3RvbVBhdGgsIHBheWxvYWQsIHJlcXVlc3RDb250ZXh0fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCByZXNvbHZlciA9IG5ldyBSb3V0ZXNSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgcmVxdWVzdDogdGhpcy5nZXRSZXF1ZXN0KCksXG4gICAgICByZXNwb25zZVxuICAgIH0pXG4gICAgcmVzb2x2ZXIucGFyYW1zID0ge31cbiAgICBjb25zdCByb3V0ZUhvb2tNYXRjaCA9IGF3YWl0IHJlc29sdmVyLnJlc29sdmVSb3V0ZVJlc29sdmVySG9va3MoY3VzdG9tUGF0aClcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUm91dGVzID0gY29uZmlndXJhdGlvbi5nZXRSb3V0ZXMoKVxuICAgIGNvbnN0IHJvdXRlTWF0Y2ggPSByb3V0ZUhvb2tNYXRjaCB8fCAhY29uZmlndXJhdGlvblJvdXRlcz8ucm9vdFJvdXRlID8gdW5kZWZpbmVkIDogcmVzb2x2ZXIubWF0Y2hQYXRoV2l0aFJvdXRlcyhjb25maWd1cmF0aW9uUm91dGVzLnJvb3RSb3V0ZSwgY3VzdG9tUGF0aClcblxuICAgIGlmICghcm91dGVIb29rTWF0Y2ggJiYgIXJvdXRlTWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY3VzdG9tIGZyb250ZW5kIG1vZGVsIHJvdXRlIG1hdGNoZWQgJyR7Y3VzdG9tUGF0aH0nYClcbiAgICB9XG5cbiAgICBjb25zdCBhY3Rpb25QYXJhbSA9IHJvdXRlSG9va01hdGNoPy5hY3Rpb24gfHwgcmVzb2x2ZXIucGFyYW1zLmFjdGlvblxuICAgIGNvbnN0IGNvbnRyb2xsZXJQYXJhbSA9IHJvdXRlSG9va01hdGNoPy5jb250cm9sbGVyIHx8IHJlc29sdmVyLnBhcmFtcy5jb250cm9sbGVyXG4gICAgY29uc3QgYWN0aW9uVmFsdWUgPSB0eXBlb2YgYWN0aW9uUGFyYW0gPT09IFwic3RyaW5nXCIgPyBhY3Rpb25QYXJhbSA6IChBcnJheS5pc0FycmF5KGFjdGlvblBhcmFtKSA/IGFjdGlvblBhcmFtWzBdIDogdW5kZWZpbmVkKVxuICAgIGNvbnN0IGNvbnRyb2xsZXJWYWx1ZSA9IHR5cGVvZiBjb250cm9sbGVyUGFyYW0gPT09IFwic3RyaW5nXCIgPyBjb250cm9sbGVyUGFyYW0gOiAoQXJyYXkuaXNBcnJheShjb250cm9sbGVyUGFyYW0pID8gY29udHJvbGxlclBhcmFtWzBdIDogdW5kZWZpbmVkKVxuXG4gICAgaWYgKHR5cGVvZiBhY3Rpb25WYWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCBhY3Rpb25WYWx1ZS5sZW5ndGggPCAxIHx8IHR5cGVvZiBjb250cm9sbGVyVmFsdWUgIT09IFwic3RyaW5nXCIgfHwgY29udHJvbGxlclZhbHVlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ3VzdG9tIGZyb250ZW5kIG1vZGVsIHJvdXRlIG1hdGNoZWQgJyR7Y3VzdG9tUGF0aH0nIHdpdGhvdXQgY29udHJvbGxlci9hY3Rpb24gcGFyYW1zYClcbiAgICB9XG5cbiAgICBjb25zdCBhY3Rpb24gPSBpbmZsZWN0aW9uLmNhbWVsaXplKGFjdGlvblZhbHVlLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKS5yZXBsYWNlQWxsKFwiL1wiLCBcIl9cIiksIHRydWUpXG4gICAgY29uc3QgY29udHJvbGxlciA9IGNvbnRyb2xsZXJWYWx1ZVxuICAgIGNvbnN0IGNvbnRyb2xsZXJQYXRoID0gcm91dGVIb29rTWF0Y2g/LmNvbnRyb2xsZXJQYXRoIHx8IGAke2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9yb3V0ZXMvJHtjb250cm9sbGVyfS9jb250cm9sbGVyLmpzYFxuICAgIGNvbnN0IHZpZXdQYXRoID0gcm91dGVIb29rTWF0Y2g/LnZpZXdQYXRoIHx8IGAke2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9yb3V0ZXMvJHtjb250cm9sbGVyfWBcbiAgICByZXNvbHZlci5yb3V0ZUhvb2tDb250cm9sbGVyQ2xhc3MgPSByb3V0ZUhvb2tNYXRjaD8uY29udHJvbGxlckNsYXNzXG4gICAgY29uc3QgY29udHJvbGxlckNsYXNzID0gYXdhaXQgcmVzb2x2ZXIucmVzb2x2ZUNvbnRyb2xsZXJDbGFzcyh7Y29udHJvbGxlclBhdGh9KVxuICAgIGNvbnN0IGNvbnRyb2xsZXJQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAge1xuICAgICAgICAuLi4oKHBheWxvYWQgJiYgdHlwZW9mIHBheWxvYWQgPT09IFwib2JqZWN0XCIpID8gcGF5bG9hZCA6IHt9KSxcbiAgICAgICAgLi4ucmVzb2x2ZXIucGFyYW1zXG4gICAgICB9XG4gICAgKVxuICAgIGNvbnN0IGNvbnRyb2xsZXJJbnN0YW5jZSA9IG5ldyBjb250cm9sbGVyQ2xhc3Moe1xuICAgICAgYWN0aW9uLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGNvbnRyb2xsZXIsXG4gICAgICBwYXJhbXM6IGNvbnRyb2xsZXJQYXJhbXMsXG4gICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuZ2V0UmVxdWVzdCgpKSxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgdmlld1BhdGhcbiAgICB9KVxuXG4gICAgLy8gUHJlc2VydmUgdGhlIGNsaWVudCdzIG93biBjb21tYW5kIGFyZ3VtZW50cyBiZWZvcmUgcm91dGUgZnJhbWV3b3JrIHBhcmFtcyB3b25cbiAgICAvLyB0aGUgYGNvbnRyb2xsZXJQYXJhbXNgIG1lcmdlIGFib3ZlLCBzbyBhIHR5cGVkIGNvbW1hbmQgbWV0aG9kIChgYXN5bmMgbmFtZShhcmdzKWApXG4gICAgLy8gcmVjZWl2ZXMgdGhlIGNsaWVudCBwYXlsb2FkIOKAlCBub3QgdGhlIHJvdXRlJ3MgbWVtYmVyIGlkIC8gbW9kZWwgLyBjb250cm9sbGVyIGtleXMuXG4gICAgY29uc3QgY3VzdG9tQ29tbWFuZENvbnRyb2xsZXIgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDb250cm9sbGVyfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoY29udHJvbGxlckluc3RhbmNlKSlcblxuICAgIGN1c3RvbUNvbW1hbmRDb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZENsaWVudEFyZ3VtZW50cyA9XG4gICAgICAocGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShwYXlsb2FkKSkgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpIDoge31cblxuICAgIGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChjb250cm9sbGVyUGFyYW1zLCByZXNwb25zZSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY29udHJvbGxlckluc3RhbmNlLl9ydW5CZWZvcmVDYWxsYmFja3MoKVxuICAgICAgY29uc3QgY29udHJvbGxlck1ldGhvZHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkPn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChjb250cm9sbGVySW5zdGFuY2UpKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyTWV0aG9kc1thY3Rpb25dKClcbiAgICB9KVxuXG4gICAgY29uc3Qgc2V0Q29va2llSGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnNbXCJTZXQtQ29va2llXCJdIHx8IFtdXG5cbiAgICBmb3IgKGNvbnN0IHNldENvb2tpZUhlYWRlciBvZiBzZXRDb29raWVIZWFkZXJzKSB7XG4gICAgICB0aGlzLnJlc3BvbnNlKCkuYWRkSGVhZGVyKFwiU2V0LUNvb2tpZVwiLCBzZXRDb29raWVIZWFkZXIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gcmVzcG9uc2UuZ2V0Qm9keSgpXG5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlQm9keSAhPT0gXCJzdHJpbmdcIiB8fCByZXNwb25zZUJvZHkubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuXG4gICAgLy8gUHJlc2VydmUgbmVzdGVkIHRyYW5zcG9ydCBtYXJrZXJzIHNvIHRoZSBvdXRlciBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJXG4gICAgLy8gY2FuIHJldHVybiB0aGVtIHVuY2hhbmdlZCBhbmQgbGV0IHRoZSBjbGllbnQgaHlkcmF0ZSBvbmNlIGF0IHRoZSBlZGdlLlxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKEpTT04ucGFyc2UocmVzcG9uc2VCb2R5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGluZGV4LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDb2xsZWN0aW9uIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRJbmRleCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJpbmRleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgZmluZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGZpbmQgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEZpbmQoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiZmluZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgdXBkYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgdXBkYXRlIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRVcGRhdGUoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwidXBkYXRlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRhY2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBhdHRhY2ggYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEF0dGFjaCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJhdHRhY2hcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGRvd25sb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgZG93bmxvYWQgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZERvd25sb2FkKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImRvd25sb2FkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCB1cmwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBVUkwgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFVybCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJ1cmxcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGNyZWF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGNyZWF0ZSBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQ3JlYXRlKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImNyZWF0ZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgZGVzdHJveS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGRlc3Ryb3kgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZERlc3Ryb3koKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiZGVzdHJveVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgY3VzdG9tIGNvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEN1c3RvbSBjb2xsZWN0aW9uL21lbWJlciBjb21tYW5kIGFjdGlvbiBmb3IgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRDdXN0b21Db21tYW5kKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF5bG9hZCgpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VQYXlsb2FkLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe2FjdGlvbjogXCJmcm9udGVuZEN1c3RvbUNvbW1hbmRcIiwgY29tbWFuZFR5cGU6IFwiY3VzdG9tLWNvbW1hbmRcIiwgZXJyb3J9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY3VzdG9tIGNvbW1hbmQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXlsb2FkKCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IHBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZE1ldGhvZE5hbWVcbiAgICBjb25zdCBzY29wZSA9IHBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFNjb3BlXG5cbiAgICBpZiAodHlwZW9mIG1ldGhvZE5hbWUgIT09IFwic3RyaW5nXCIgfHwgbWV0aG9kTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgbWV0aG9kIG5hbWUuXCIpXG4gICAgfVxuXG4gICAgaWYgKHNjb3BlICE9PSBcImNvbGxlY3Rpb25cIiAmJiBzY29wZSAhPT0gXCJtZW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIGZyb250ZW5kLW1vZGVsIGN1c3RvbSBjb21tYW5kIHNjb3BlLlwiKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpXG4gICAgY29uc3QgY29tbWFuZCA9IHJlc291cmNlLnJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIWNvbW1hbmQpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYE1pc3NpbmcgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgJyR7bWV0aG9kTmFtZX0nLmApXG4gICAgfVxuXG4gICAgLy8gUGFzcyB0aGUgY2xpZW50IGNvbW1hbmQgYXJndW1lbnRzIGFzIHRoZSBtZXRob2QncyBmaXJzdCBhcmd1bWVudCBzbyBhIGNvbW1hbmRcbiAgICAvLyBtZXRob2QgY2FuIHRha2UgYSB0eXBlZCBhcmdzIG9iamVjdCAoYGFzeW5jIG5hbWUoYXJncylgKSBhbmQgdGhlIGdlbmVyYXRlZFxuICAgIC8vIGZyb250ZW5kIG1ldGhvZCBjYW4gZm9yd2FyZCB0aGUgYmFja2VuZCBtZXRob2QncyBgQHBhcmFtYC4gYHRoaXMucGFyYW1zKClgIGlzXG4gICAgLy8gdW5jaGFuZ2VkLCBzbyBleGlzdGluZyBwYXJhbWV0ZXJsZXNzIG1ldGhvZHMga2VlcCB3b3JraW5nLiBUaGUgYXJncyBhcmUgdW50cnVzdGVkXG4gICAgLy8gY2xpZW50IGlucHV0IHR5cGVkIG9ubHkgYnkgdGhlIGRlY2xhcmVkIGNvbnRyYWN0LCBzbyBtZXRob2RzIG11c3Qgc3RpbGwgdmFsaWRhdGUuXG4gICAgY29uc3QgY29tbWFuZEFyZ3VtZW50cyA9IHRoaXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRBcmd1bWVudHMocGFyYW1zKVxuICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IGNvbW1hbmQubWV0aG9kLmNhbGwoY29tbWFuZC5yZXNvdXJjZSwgY29tbWFuZEFyZ3VtZW50cylcblxuICAgIGlmICghcmVzcG9uc2VQYXlsb2FkIHx8IHR5cGVvZiByZXNwb25zZVBheWxvYWQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChcbiAgICAgIGF3YWl0IHRoaXMuYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKFxuICAgICAgICByZXNwb25zZVBheWxvYWQsXG4gICAgICAgIC8qKiBAdHlwZSB7e3NlcmlhbGl6ZTogKG1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWN0aW9uOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19ICovIChjb21tYW5kLnJlc291cmNlKSxcbiAgICAgICAgbWV0aG9kTmFtZVxuICAgICAgKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgdHlwZWQgYXJndW1lbnQgb2JqZWN0IHBhc3NlZCB0byBhIGN1c3RvbSBjb21tYW5kIG1ldGhvZC4gT24gdGhlXG4gICAqIHNoYXJlZC1lbmRwb2ludCBwYXRoIHRoZSBvcmlnaW5hbCBjbGllbnQgcGF5bG9hZCB3YXMgY2FwdHVyZWQgYmVmb3JlIHJvdXRlXG4gICAqIGZyYW1ld29yayBwYXJhbXMgd2VyZSBtZXJnZWQsIHNvIGl0IGlzIHJldHVybmVkIHZlcmJhdGltIChhIGNsaWVudCBgaWRgIHN1cnZpdmVzXG4gICAqIGEgbWVtYmVyIHJvdXRlKS4gT24gdGhlIGRpcmVjdCBwYXRoIGl0IGZhbGxzIGJhY2sgdG8gdGhlIHJlcXVlc3QgcGFyYW1zIHdpdGggdGhlXG4gICAqIGZyYW1ld29yayBrZXlzIHRoZSBjb21tYW5kIHJvdXRlIGhvb2sgaW5qZWN0ZWQgc3RyaXBwZWQgb3V0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gRGVzZXJpYWxpemVkIGZyb250ZW5kLW1vZGVsIHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGllbnQgY29tbWFuZCBhcmd1bWVudHMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEFyZ3VtZW50cyhwYXJhbXMpIHtcbiAgICBpZiAodGhpcy5fZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRDbGllbnRBcmd1bWVudHMpIHtcbiAgICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZENsaWVudEFyZ3VtZW50c1xuICAgIH1cblxuICAgIGNvbnN0IHtcbiAgICAgIGFjdGlvbjogX2FjdGlvbixcbiAgICAgIGNvbnRyb2xsZXI6IF9jb250cm9sbGVyLFxuICAgICAgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRNZXRob2ROYW1lOiBfbWV0aG9kTmFtZSxcbiAgICAgIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kU2NvcGU6IF9zY29wZSxcbiAgICAgIG1vZGVsOiBfbW9kZWwsXG4gICAgICAuLi5jb21tYW5kQXJndW1lbnRzXG4gICAgfSA9IHBhcmFtc1xuXG4gICAgcmV0dXJuIGNvbW1hbmRBcmd1bWVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWxrcyBhIGN1c3RvbS1jb21tYW5kIHJlc3BvbnNlIHBheWxvYWQgYW5kIHJlcGxhY2VzIGFueSBiYWNrZW5kIGBSZWNvcmRgXG4gICAqIGluc3RhbmNlIHdpdGggdGhlIHJlc291cmNlJ3MgcGVyLWFjdGlvbiBzZXJpYWxpemVkIGZvcm0gc28gaGFuZGxlcnMgY2FuXG4gICAqIHJldHVybiBge3JlY29yZCwgc3RhdHVzOiBcIm9rXCJ9YCBpbnN0ZWFkIG9mIGV4cGxpY2l0bHkgY2FsbGluZ1xuICAgKiBgYXdhaXQgdGhpcy5zZXJpYWxpemUocmVjb3JkLCBhY3Rpb24pYC4gUGxhaW4gb2JqZWN0cywgYXJyYXlzLCBhbmRcbiAgICogcHJpbWl0aXZlIHZhbHVlcyBwYXNzIHRocm91Z2ggYW5kIGFyZSBsYXRlciBlbmNvZGVkIGJ5XG4gICAqIGBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVgLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7e3NlcmlhbGl6ZTogKG1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWN0aW9uOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19IHJlc291cmNlIC0gUmVzb3VyY2UgaW5zdGFuY2UgcHJvdmlkaW5nIGBzZXJpYWxpemVgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQ3VzdG9tIGNvbW1hbmQgbWV0aG9kIG5hbWUgcGFzc2VkIHRvIGByZXNvdXJjZS5zZXJpYWxpemVgIGZvciBwZXItYWN0aW9uIGF1dGhvcml6YXRpb24gZmlsdGVyaW5nLlxuICAgKiBAcGFyYW0ge1dlYWtTZXQ8b2JqZWN0Pn0gW3NlZW5dIC0gUmVjdXJzaW9uIHN0YWNrIG9mIHBsYWluLW9iamVjdCBjb250YWluZXJzIGN1cnJlbnRseSBiZWluZyB3YWxrZWQuIE1lbWJlcnNoaXAgaXMgYWRkZWQgb24gZW50cnkgYW5kIHJlbW92ZWQgb24gZXhpdCBzbyBhIGNvbnRhaW5lciBzaGFyZWQgYmV0d2VlbiBzaWJsaW5ncyAoaS5lLiByZWZlcmVuY2VkIHR3aWNlIGJ1dCBub3QgY3ljbGljYWxseSkgaXMgd2Fsa2VkIG9uIGVhY2ggcmVmZXJlbmNlIGluc3RlYWQgb2YgYmVpbmcgc2hvcnQtY2lyY3VpdGVkIHRoZSBzZWNvbmQgdGltZSwgd2hpY2ggd291bGQgbGV0IGJhY2tlbmQgYFJlY29yZGAgaW5zdGFuY2VzIGluc2lkZSBpdCBieXBhc3MgYHJlc291cmNlLnNlcmlhbGl6ZWAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHdpdGggYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgcmVwbGFjZWQgYnkgc2VyaWFsaXplZCBtYXJrZXJzLlxuICAgKi9cbiAgYXN5bmMgYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKHZhbHVlLCByZXNvdXJjZSwgYWN0aW9uLCBzZWVuID0gbmV3IFdlYWtTZXQoKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICBpZiAoaXNCYWNrZW5kTW9kZWxJbnN0YW5jZSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJpY2hTZXJpYWxpemVkID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKHZhbHVlLCBhY3Rpb24pXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSB2YWx1ZS5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgLy8gV3JhcCB0aGUgcmVzb3VyY2Utc2VyaWFsaXplZCBwYXlsb2FkIGluIHRoZSBmcm9udGVuZF9tb2RlbCB0cmFuc3BvcnRcbiAgICAgIC8vIG1hcmtlci4gTWFya2VyLWJhc2VkIGRlY29kaW5nIHJvdXRlcyB0aHJvdWdoIGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAsXG4gICAgICAvLyBzbyBhYmlsaXRpZXMgLyBxdWVyeURhdGEgLyBhc3NvY2lhdGlvbkNvdW50cyAvIHByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICAgIC8vIGJha2VkIGludG8gdGhlIHJpY2ggYXR0cmlidXRlcyBieSBgcmVzb3VyY2Uuc2VyaWFsaXplYCBhcmUgcmVzdG9yZWQgb25cbiAgICAgIC8vIHRoZSBjbGllbnQgd2l0aG91dCBjYWxsZXJzIG5lZWRpbmcgdG8gd3JhcCBtb2RlbHMgbWFudWFsbHkuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBfX3ZlbG9jaW91c190eXBlOiBcImZyb250ZW5kX21vZGVsXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHJpY2hTZXJpYWxpemVkLFxuICAgICAgICBtb2RlbE5hbWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIC8qKlxuICAgICAgICogUmVzdWx0LlxuICAgICAgICogQHR5cGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHJlc3VsdCA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdmFsdWUpIHtcbiAgICAgICAgcmVzdWx0LnB1c2goYXdhaXQgdGhpcy5hdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQoZW50cnksIHJlc291cmNlLCBhY3Rpb24sIHNlZW4pKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBjb25zdCBjb250YWluZXIgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuXG4gICAgICBpZiAoc2Vlbi5oYXMoY29udGFpbmVyKSkge1xuICAgICAgICAvLyBDeWNsaWMgYmFjay1yZWZlcmVuY2UgYWxvbmcgdGhlIGN1cnJlbnQgcmVjdXJzaW9uIHBhdGg7IHRoZVxuICAgICAgICAvLyBhbmNlc3RvciBmcmFtZSBpcyBzdGlsbCB3YWxraW5nIHRoaXMgY29udGFpbmVyIGFuZCB3aWxsIHByb2R1Y2VcbiAgICAgICAgLy8gaXRzIHNlcmlhbGl6ZWQgZm9ybS4gUmV0dXJuaW5nIHRoZSBvcmlnaW5hbCBjb250YWluZXIgaGVyZVxuICAgICAgICAvLyBicmVha3MgdGhlIGN5Y2xlIHdpdGhvdXQgYnlwYXNzaW5nIHRoZSB3YWxrZXIgZm9yIHNpYmxpbmdzIHRoYXRcbiAgICAgICAgLy8gc2hhcmUgYSBub24tY3ljbGljIHJlZmVyZW5jZSAodGhvc2UgcmUtZW50ZXIgdGhlIGJyYW5jaCBiZWxvd1xuICAgICAgICAvLyBiZWNhdXNlIHRoZSBjb250YWluZXIgaXMgcmVtb3ZlZCBmcm9tIGBzZWVuYCBvbiBzdGFjayBleGl0KS5cbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lclxuICAgICAgfVxuXG4gICAgICBzZWVuLmFkZChjb250YWluZXIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZXN1bHQuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICAgICAgZm9yIChjb25zdCBba2V5LCBuZXN0ZWRdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRhaW5lcikpIHtcbiAgICAgICAgICAvLyBgYXNzaWduU2FmZVByb3BlcnR5YCBzdG9yZXMga2V5cyBsaWtlIGBfX3Byb3RvX19gIGFzIG93blxuICAgICAgICAgIC8vIGRhdGEgcHJvcGVydGllcyBpbnN0ZWFkIG9mIGludm9raW5nIHRoZSBwcm90b3R5cGUgc2V0dGVyLFxuICAgICAgICAgIC8vIHNvIGEgY3VzdG9tLWNvbW1hbmQgcmVzcG9uc2UgdGhhdCBlY2hvZXMgcGFyc2VkIGNsaWVudFxuICAgICAgICAgIC8vIGlucHV0IGNhbm5vdCBwb2xsdXRlIGBPYmplY3QucHJvdG90eXBlYCBoZXJlLiBUaGUgdHJhbnNwb3J0XG4gICAgICAgICAgLy8gc2VyaWFsaXplciBhcHBsaWVzIHRoZSBzYW1lIHByb3RlY3Rpb24gb24gaXRzIG93biBwYXNzOyB3ZVxuICAgICAgICAgIC8vIGp1c3QgcHJlc2VydmUgaXQgYWNyb3NzIHRoZSBhdXRvLXNlcmlhbGl6ZSB3YWxrLlxuICAgICAgICAgIGFzc2lnblNhZmVQcm9wZXJ0eShyZXN1bHQsIGtleSwgYXdhaXQgdGhpcy5hdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQobmVzdGVkLCByZXNvdXJjZSwgYWN0aW9uLCBzZWVuKSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHNlZW4uZGVsZXRlKGNvbnRhaW5lcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG59XG4iXX0=