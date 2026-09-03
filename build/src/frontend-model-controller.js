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
import { compositeModelPrimaryKeyCohortSql, modelPrimaryKeyCacheKey, modelPrimaryKeyConditions, modelPrimaryKeyValueFromCacheKey, readModelPrimaryKeyValue, scalarModelPrimaryKey } from "./utils/model-primary-key.js";
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
        if (this.frontendModelResourceModelClass(frontendModelResource) === modelClass) {
            return frontendModelResource;
        }
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
     * @returns {import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Frontend model primary key.
     */
    frontendModelPrimaryKey() {
        return this.frontendModelResourceInstance().primaryKey();
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
     * @returns {import("./utils/model-primary-key.js").ModelPrimaryKeyValue} - Primary key value.
     */
    frontendModelPrimaryKeyValue(model) {
        const primaryKey = this.frontendModelPrimaryKey();
        return readModelPrimaryKeyValue(primaryKey, (attributeName) => model.readAttribute(attributeName));
    }
    /**
     * Returns the authorized identities from a candidate cohort without per-record queries.
     * @param {object} args - Arguments.
     * @param {import("./utils/model-primary-key.js").ModelPrimaryKeyValue[]} args.identities - Candidate identities.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class owning the identity attributes.
     * @param {import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.primaryKey - Identity definition.
     * @param {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} args.query - Authorized query.
     * @returns {Promise<Set<string>>} - Canonical authorized identity keys.
     */
    async frontendModelAuthorizedIdentitySet({ identities, modelClass, primaryKey, query }) {
        if (!Array.isArray(primaryKey)) {
            const authorizedIds = await query
                .where({ [primaryKey]: identities })
                .pluck(primaryKey);
            return new Set(authorizedIds.map((value) => modelPrimaryKeyCacheKey(primaryKey, value)));
        }
        const cohorts = query.driver.chunkValues(identities, (cohort) => query
            .clone()
            .where(compositeModelPrimaryKeyCohortSql({ modelClass, primaryKey, query, values: cohort }))
            .toSql());
        const authorizedIdentityKeys = new Set();
        for (const cohort of cohorts) {
            const authorizedModels = await query
                .clone()
                .where(compositeModelPrimaryKeyCohortSql({ modelClass, primaryKey, query, values: cohort }))
                .toArray();
            for (const model of authorizedModels) {
                const identity = readModelPrimaryKeyValue(primaryKey, (attributeName) => model.readAttribute(attributeName));
                authorizedIdentityKeys.add(modelPrimaryKeyCacheKey(primaryKey, identity));
            }
        }
        return authorizedIdentityKeys;
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
        const identities = models.map((model) => this.frontendModelPrimaryKeyValue(model));
        const authorizedIds = await this.frontendModelAuthorizedIdentitySet({
            identities,
            modelClass: this.frontendModelClass(),
            primaryKey,
            query: this.frontendModelAuthorizedQuery(action)
        });
        return models.filter((model) => authorizedIds.has(modelPrimaryKeyCacheKey(primaryKey, this.frontendModelPrimaryKeyValue(model))));
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
     * @param {import("./utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record id.
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
            for (const action of entry.actions) {
                /** @type {Set<string>} */
                let allowedIds;
                try {
                    const authorizedQuery = modelClass.accessibleFor(action, ability);
                    const identities = candidates.map((record) => record.id());
                    allowedIds = await this.frontendModelAuthorizedIdentitySet({
                        identities,
                        modelClass,
                        primaryKey,
                        query: authorizedQuery
                    });
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
                    const idValue = record.id();
                    const allowed = allowedIds.has(modelPrimaryKeyCacheKey(primaryKey, idValue));
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
        const primaryKey = scalarModelPrimaryKey(modelClass.primaryKey(), "MSSQL distinct frontend-model queries");
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
         * @type {Map<typeof import("./database/record/index.js").default, import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition>} */
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
            const identities = relatedModels.map((model) => model.id());
            const authorizedIds = await this.frontendModelAuthorizedIdentitySet({
                identities,
                modelClass: relatedModelClass,
                primaryKey,
                query: relatedModelClass.accessibleFor(abilityAction)
            });
            primaryKeysByClass.set(relatedModelClass, primaryKey);
            authorizedIdsByClass.set(relatedModelClass, authorizedIds);
        }
        return models.filter((model) => {
            const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor);
            const authorizedIds = authorizedIdsByClass.get(relatedModelClass);
            const primaryKey = primaryKeysByClass.get(relatedModelClass);
            if (!authorizedIds || !primaryKey)
                return false;
            return authorizedIds.has(modelPrimaryKeyCacheKey(primaryKey, model.id()));
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
        const primaryKey = this.frontendModelPrimaryKey();
        let id = params.id;
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
        if (!Array.isArray(primaryKey) && ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1)) {
            return this.frontendModelErrorPayload("Expected model id.", { errorType: "validation_error" });
        }
        try {
            if (Array.isArray(primaryKey) && typeof id === "string") {
                id = modelPrimaryKeyValueFromCacheKey(primaryKey, id);
            }
            modelPrimaryKeyConditions(primaryKey, id);
        }
        catch (error) {
            if (!(error instanceof TypeError))
                throw error;
            return this.frontendModelErrorPayload(error.message, { errorType: "validation_error" });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3RDLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sVUFBVSxNQUFNLGlCQUFpQixDQUFBO0FBQ3hDLE9BQU8seUJBQXlCLE1BQU0sNENBQTRDLENBQUE7QUFDbEYsT0FBTyxRQUFRLE1BQU0sa0NBQWtDLENBQUE7QUFDdkQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUNBQXlDLENBQUE7QUFDM0csT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFFLHlCQUF5QixFQUFFLHVDQUF1QyxFQUFFLDJDQUEyQyxFQUFDLE1BQU0sMENBQTBDLENBQUE7QUFDcFEsT0FBTyxFQUFDLCtCQUErQixFQUFFLGtCQUFrQixFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHFDQUFxQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDbEYsT0FBTyxFQUFDLHNCQUFzQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDdEYsT0FBTyxFQUFDLHVCQUF1QixFQUFFLGNBQWMsSUFBSSxtQkFBbUIsRUFBRSxjQUFjLElBQUksbUJBQW1CLEVBQUUsY0FBYyxJQUFJLG1CQUFtQixFQUFFLGdCQUFnQixJQUFJLHFCQUFxQixFQUFFLHVCQUF1QixJQUFJLDRCQUE0QixFQUFFLGFBQWEsSUFBSSxrQkFBa0IsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ2hVLE9BQU8sRUFBQyxrQkFBa0IsRUFBRSxzQ0FBc0MsRUFBRSxzQkFBc0IsRUFBRSxvQ0FBb0MsRUFBQyxNQUFNLDhDQUE4QyxDQUFBO0FBQ3JMLE9BQU8s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QU8sTUFBTSxDQUFBO1lBQ2YsQ0FBQztvQkFBUyxDQUFDO2dCQUNULElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUE7WUFDeEIsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7Q0FFRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge3JhbmRvbVVVSUR9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBDb250cm9sbGVyIGZyb20gXCIuL2NvbnRyb2xsZXIuanNcIlxuaW1wb3J0IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UgZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQgUmVzcG9uc2UgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0fSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QsIGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHN9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7Y3JlYXRlT2ZmbGluZUdyYW50RnJvbUJvb3RzdHJhcCwgdmVyaWZ5T2ZmbGluZUdyYW50fSBmcm9tIFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIlxuaW1wb3J0IHtzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9ufSBmcm9tIFwiLi9zeW5jL3NlcnZlci1jaGFuZ2UtZmVlZC5qc1wiXG5pbXBvcnQge211dGF0aW9uSWRlbXBvdGVuY3lLZXksIHZlcmlmeVNpZ25lZE11dGF0aW9ufSBmcm9tIFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiXG5pbXBvcnQge0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yLCBub3JtYWxpemVHcm91cCBhcyBub3JtYWxpemVRdWVyeUdyb3VwLCBub3JtYWxpemVKb2lucyBhcyBub3JtYWxpemVRdWVyeUpvaW5zLCBub3JtYWxpemVQbHVjayBhcyBub3JtYWxpemVRdWVyeVBsdWNrLCBub3JtYWxpemVQcmVsb2FkIGFzIG5vcm1hbGl6ZVF1ZXJ5UHJlbG9hZCwgbm9ybWFsaXplU2VhcmNoT3BlcmF0b3IgYXMgbm9ybWFsaXplUXVlcnlTZWFyY2hPcGVyYXRvciwgbm9ybWFsaXplU29ydCBhcyBub3JtYWxpemVRdWVyeVNvcnR9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiXG5pbXBvcnQge2Fzc2lnblNhZmVQcm9wZXJ0eSwgZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIGlzQmFja2VuZE1vZGVsSW5zdGFuY2UsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7cmVxdWVzdERldGFpbHN9IGZyb20gXCIuL2Vycm9yLXJlcG9ydGluZy9yZXF1ZXN0LWRldGFpbHMuanNcIlxuaW1wb3J0IFJvdXRlc1Jlc29sdmVyIGZyb20gXCIuL3JvdXRlcy9yZXNvbHZlci5qc1wiXG5pbXBvcnQge1ZhbGlkYXRpb25FcnJvcn0gZnJvbSBcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCBSZWNvcmROb3RGb3VuZEVycm9yIGZyb20gXCIuL2RhdGFiYXNlL3JlY29yZC9yZWNvcmQtbm90LWZvdW5kLWVycm9yLmpzXCJcbmltcG9ydCB7Y2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSB9IGZyb20gXCIuL2RhdGFiYXNlL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgaXNEYXRlIGZyb20gXCIuL3V0aWxzL2lzLWRhdGUuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7Y29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5Q29ob3J0U3FsLCBtb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXksIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5fSBmcm9tIFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge1JhbnNhY2tRdWVyeUVycm9yLCBub3JtYWxpemVSYW5zYWNrR3JvdXAsIHBhcnNlUmFuc2Fja1NvcnR9IGZyb20gXCIuL3V0aWxzL3JhbnNhY2suanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxTZWFyY2ggdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTZWFyY2hcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gKiBAcHJvcGVydHkge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsU29ydCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFNvcnRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzb3J0IGJ5LlxuICogQHByb3BlcnR5IHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsR3JvdXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxHcm91cFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIGdyb3VwIGJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUGx1Y2sgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxQbHVja1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIHBsdWNrLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUGFnaW5hdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZENvbnRleHQgJiB7XG4gKiAgIGFjdGlvbjogc3RyaW5nLFxuICogICBleHBlY3RlZEVycm9yOiBib29sZWFuLFxuICogICBmcm9udGVuZE1vZGVsRW5kcG9pbnQ6IHRydWVcbiAqIH19IEZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dFxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5T3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IFtyZXNvdXJjZV0gLSBSZXNvdXJjZSBwcm92aWRpbmcgcXVlcnkgaG9va3MuXG4gKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0ICYgUmVjb3JkPHN5bWJvbCwgU2V0PHN0cmluZz4gfCB1bmRlZmluZWQ+fSBGcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YSAqL1xuLyoqXG4gKiBAY2FsbGJhY2sgRnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9va1xuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlIGJlaW5nIHNlcmlhbGl6ZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gcmVzb3VyY2UgLSBSZXNvbHZlZCBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlLCBpZiBhbnkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHByZWxvYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IHN0cmluZ1tdIHwgYm9vbGVhbiB8IHVuZGVmaW5lZCB8IG51bGx9IHByZWxvYWQgLSBQcmVsb2FkIHNob3J0aGFuZC5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsfSAtIE5vcm1hbGl6ZWQgcHJlbG9hZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFByZWxvYWQocHJlbG9hZCkge1xuICBpZiAoIXByZWxvYWQpIHJldHVybiBudWxsXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gbm9ybWFsaXplUXVlcnlQcmVsb2FkKHByZWxvYWQpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIGpvaW5zLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gam9pbnMgLSBKb2lucyBwYXlsb2FkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gTm9ybWFsaXplZCByZWxhdGlvbnNoaXAtb2JqZWN0IGpvaW5zLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsSm9pbnMoam9pbnMpIHtcbiAgaWYgKCFqb2lucykgcmV0dXJuIG51bGxcblxuICB0cnkge1xuICAgIHJldHVybiBub3JtYWxpemVRdWVyeUpvaW5zKGpvaW5zKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB0aHJvd0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yRm9yUGFyc2VyRXJyb3IoZXJyb3IpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBzZWxlY3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzZWxlY3QgLSBTZWxlY3QgcGF5bG9hZC5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gW3Jvb3RNb2RlbE5hbWVdIC0gT3B0aW9uYWwgcm9vdCBtb2RlbCBuYW1lIGZvciBzaG9ydGhhbmQgcGF5bG9hZHMuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHwgbnVsbH0gLSBOb3JtYWxpemVkIG1vZGVsLW5hbWUga2V5ZWQgc2VsZWN0IHJlY29yZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlbGVjdChzZWxlY3QsIHJvb3RNb2RlbE5hbWUgPSBudWxsKSB7XG4gIGlmICghc2VsZWN0KSByZXR1cm4gbnVsbFxuXG4gIGlmICh0eXBlb2Ygc2VsZWN0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgaWYgKCFyb290TW9kZWxOYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VsZWN0IHNob3J0aGFuZCB3aXRob3V0IHJvb3QgbW9kZWwgbmFtZVwiKVxuICAgIH1cblxuICAgIHJldHVybiB7W3Jvb3RNb2RlbE5hbWVdOiBbc2VsZWN0XX1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdCkpIHtcbiAgICBpZiAoIXJvb3RNb2RlbE5hbWUpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwiSW52YWxpZCBzZWxlY3Qgc2hvcnRoYW5kIHdpdGhvdXQgcm9vdCBtb2RlbCBuYW1lXCIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdCkge1xuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlbGVjdCBhdHRyaWJ1dGUgZm9yICR7cm9vdE1vZGVsTmFtZX06ICR7dHlwZW9mIGF0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1tyb290TW9kZWxOYW1lXTogQXJyYXkuZnJvbShuZXcgU2V0KHNlbGVjdCkpfVxuICB9XG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHNlbGVjdCkpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWxlY3QgdHlwZTogJHt0eXBlb2Ygc2VsZWN0fWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPn0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgZm9yIChjb25zdCBbbW9kZWxOYW1lLCBzZWxlY3RWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc2VsZWN0KSkge1xuICAgIGlmICh0eXBlb2Ygc2VsZWN0VmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIG5vcm1hbGl6ZWRbbW9kZWxOYW1lXSA9IFtzZWxlY3RWYWx1ZV1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNlbGVjdFZhbHVlKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VsZWN0IHZhbHVlIGZvciAke21vZGVsTmFtZX06ICR7dHlwZW9mIHNlbGVjdFZhbHVlfWApXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdFZhbHVlKSB7XG4gICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VsZWN0IGF0dHJpYnV0ZSBmb3IgJHttb2RlbE5hbWV9OiAke3R5cGVvZiBhdHRyaWJ1dGVOYW1lfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFttb2RlbE5hbWVdID0gQXJyYXkuZnJvbShuZXcgU2V0KHNlbGVjdFZhbHVlKSlcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbmNvbnN0IGZyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbCA9IFN5bWJvbChcImZyb250ZW5kTW9kZWxKb2luZWRQYXRoc1wiKVxuY29uc3QgZnJvbnRlbmRNb2RlbEdyb3VwZWRDb2x1bW5zU3ltYm9sID0gU3ltYm9sKFwiZnJvbnRlbmRNb2RlbEdyb3VwZWRDb2x1bW5zXCIpXG5jb25zdCBmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sID0gU3ltYm9sKFwiZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFwiKVxuY29uc3QgZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvck1lc3NhZ2UgPSBcIlJlcXVlc3QgZmFpbGVkLlwiXG5cbi8qKlxuICogQnVpbGRzIGEgY2xpZW50LXNhZmUgc3luYyByZXBsYXkgdmFsaWRhdGlvbiBlcnJvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gQ2xpZW50LXNhZmUgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICogQHBhcmFtIHt1bmtub3dufSBbY2F1c2VdIC0gT3JpZ2luYWwgY2F1c2UuXG4gKiBAcmV0dXJucyB7VmVsb2Npb3VzRXJyb3J9IC0gQ2xpZW50LXNhZmUgcmVwbGF5IGVycm9yLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IobWVzc2FnZSwgY2F1c2UpIHtcbiAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUobWVzc2FnZSwge1xuICAgIGNhdXNlLFxuICAgIGNvZGU6IFwiZnJvbnRlbmRfc3luY19yZXBsYXlfZXJyb3JcIlxuICB9KVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcXVlcnkgbWV0YWRhdGEuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gcXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YX0gLSBRdWVyeSBtZXRhZGF0YSBhY2Nlc3MgaGVscGVyLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShxdWVyeSkge1xuICByZXR1cm4gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YX0gKi8gKHF1ZXJ5KVxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIGNsaWVudC1zYWZlIGZyb250ZW5kLW1vZGVsIHF1ZXJ5IGVycm9yLlxuICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICogQHJldHVybnMge1ZlbG9jaW91c0Vycm9yfSBDbGllbnQtc2FmZSBxdWVyeSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IobWVzc2FnZSkge1xuICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShtZXNzYWdlLCB7Y29kZTogXCJmcm9udGVuZC1tb2RlbC1xdWVyeS1lcnJvclwifSlcbn1cblxuLyoqXG4gKiBUaHJvd3MgYSBjbGllbnQtc2FmZSBmcm9udGVuZC1tb2RlbCBxdWVyeSBlcnJvciBmb3IgdHlwZWQgcXVlcnkgcGFyc2VyIGVycm9ycy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRXJyb3IgcmFpc2VkIHdoaWxlIG5vcm1hbGl6aW5nIGNsaWVudCBxdWVyeSBwYXJhbXMuXG4gKiBAcmV0dXJucyB7bmV2ZXJ9IEFsd2F5cyB0aHJvd3MuXG4gKi9cbmZ1bmN0aW9uIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcikge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBGcm9udGVuZE1vZGVsUXVlcnlFcnJvciB8fCBlcnJvciBpbnN0YW5jZW9mIFJhbnNhY2tRdWVyeUVycm9yKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoZXJyb3IubWVzc2FnZSlcbiAgfVxuXG4gIHRocm93IGVycm9yXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZXJyb3IgY2FycmllcyBhbiBgZXJyb3IudmVsb2Npb3VzYCBtZXRhZGF0YSBiYWcuIFRoZVxuICogcHJlc2VuY2Ugb2YgYW55IHN1Y2ggYmFnIG1hcmtzIHRoZSBlcnJvciBhcyBcImFubm90YXRlZCBieSB0aGVcbiAqIGRldmVsb3BlciBmb3IgdGhlIGZyb250ZW5kXCIg4oCUIHRoZSBmcmFtZXdvcmsgdHJlYXRzIGl0IGFzXG4gKiB1c2VyLWZhY2luZzogc3VyZmFjZSB0aGUgbWVzc2FnZSwgZm9yd2FyZCB0aGUgbWV0YWRhdGEsIGFuZCBza2lwXG4gKiB0aGUgbm9pc3kgZW5kcG9pbnQtZXJyb3IgbG9nLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBlcnJvciBoYXMgVmVsb2Npb3VzIGZyb250ZW5kIG1ldGFkYXRhLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikge1xuICBpZiAoIWVycm9yIHx8IHR5cGVvZiBlcnJvciAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlXG5cbiAgLy8gUnVudGltZSBjaGVja3MgYWJvdmUgbmFycm93IHRoaXMgY2F1Z2h0IHZhbHVlIHRvIHRoZSBtZXRhZGF0YSByZWNvcmQgc2hhcGUuXG4gIGNvbnN0IGVycm9yUmVjb3JkID0gLyoqIEB0eXBlIHt7dmVsb2Npb3VzPzogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH19ICovIChlcnJvcilcblxuICByZXR1cm4gaXNQbGFpbk9iamVjdChlcnJvclJlY29yZC52ZWxvY2lvdXMpXG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZXJyb3IgaXMgYW4gZXhwZWN0ZWQgZnJvbnRlbmQtbW9kZWwgdXNlci1mbG93IGZhaWx1cmUuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGVycm9yIGlzIGV4cGVjdGVkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRXhwZWN0ZWRFcnJvcihlcnJvcikge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZWNvcmROb3RGb3VuZEVycm9yKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHJldHVybiB0cnVlXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkgcmV0dXJuIHRydWVcbiAgaWYgKGZyb250ZW5kTW9kZWxFcnJvckhhc1ZlbG9jaW91c01ldGFkYXRhKGVycm9yKSkgcmV0dXJuIHRydWVcblxuICByZXR1cm4gZmFsc2Vcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHZlbG9jaW91cyBtZXRhZGF0YSBmb3IgZXJyb3IuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWQgfCBudWxsfSBGcm9udGVuZC1tb2RlbCBWZWxvY2lvdXMgbWV0YWRhdGEgd2hlbiBwcmVzZW50LlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsVmVsb2Npb3VzTWV0YWRhdGFGb3JFcnJvcihlcnJvcikge1xuICBjb25zdCBlcnJvckNvZGUgPSBlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSAmJiB0eXBlb2YgZXJyb3IuY29kZSA9PT0gXCJzdHJpbmdcIiAmJiBlcnJvci5jb2RlLmxlbmd0aCA+IDBcbiAgICA/IGVycm9yLmNvZGVcbiAgICA6IG51bGxcblxuICBpZiAoIWZyb250ZW5kTW9kZWxFcnJvckhhc1ZlbG9jaW91c01ldGFkYXRhKGVycm9yKSkge1xuICAgIHJldHVybiBlcnJvckNvZGUgPyB7Y29kZTogZXJyb3JDb2RlfSA6IG51bGxcbiAgfVxuXG4gIC8vIGZyb250ZW5kTW9kZWxFcnJvckhhc1ZlbG9jaW91c01ldGFkYXRhIGd1YXJkcyB0aGUgY2F1Z2h0IHZhbHVlIGJlZm9yZSB0aGlzIGNhc3QuXG4gIGNvbnN0IGVycm9yUmVjb3JkID0gLyoqIEB0eXBlIHt7dmVsb2Npb3VzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfX0gKi8gKGVycm9yKVxuICBjb25zdCBtZXRhZGF0YSA9IGVycm9yUmVjb3JkLnZlbG9jaW91c1xuXG4gIHJldHVybiBlcnJvckNvZGUgPyB7Li4ubWV0YWRhdGEsIGNvZGU6IGVycm9yQ29kZX0gOiBtZXRhZGF0YVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY2xpZW50IG1lc3NhZ2UgZm9yIGVycm9yLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgLSBXaGV0aGVyIHVuZXhwZWN0ZWQgZXJyb3IgbWVzc2FnZXMgbWF5IGJlIGV4cG9zZWQuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1lc3NhZ2Ugc2FmZSB0byByZXR1cm4gdG8gQVBJIGNsaWVudHMuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxDbGllbnRNZXNzYWdlRm9yRXJyb3IoZXJyb3IsIGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKSB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFJlY29yZE5vdEZvdW5kRXJyb3IpIHtcbiAgICByZXR1cm4gXCJSZWNvcmQgbm90IGZvdW5kLlwiXG4gIH1cblxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICByZXR1cm4gZXJyb3IubWVzc2FnZVxuICB9XG5cbiAgLy8gVmFsaWRhdGlvbiBmYWlsdXJlcyBhcmUgZXhwZWN0ZWQgdXNlci1mbG93IGVycm9ycy4gQWx3YXlzIGZvcndhcmQgdGhlXG4gIC8vIHZhbGlkYXRpb24gc3VtbWFyeSBzbyB0aGUgY2xpZW50IHNob3dzIHRoZSByZWFsIHJlYXNvbiAoZS5nLiBcIk5hbWUgY2FuJ3RcbiAgLy8gYmUgYmxhbmtcIikgaW5zdGVhZCBvZiB0aGUgZ2VuZXJpYyBcIlJlcXVlc3QgZmFpbGVkLlwiIG1lc3NhZ2UsIHJlZ2FyZGxlc3Mgb2ZcbiAgLy8gd2hldGhlciB0aGUgcmFpc2luZyBjb2RlIGFsc28gYXR0YWNoZWQgZXJyb3IudmVsb2Npb3VzIG1ldGFkYXRhLlxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IubWVzc2FnZVxuICB9XG5cbiAgaWYgKGZyb250ZW5kTW9kZWxFcnJvckhhc1ZlbG9jaW91c01ldGFkYXRhKGVycm9yKSAmJiBlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yLm1lc3NhZ2VcbiAgfVxuXG4gIGlmIChleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyAmJiBlcnJvciBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gZXJyb3IubWVzc2FnZVxuXG4gIHJldHVybiBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZGVidWcgcGF5bG9hZCBmb3IgZXJyb3IuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIEN1cnJlbnQgY29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy5lcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfSAtIE9wdGlvbmFsIGludGVybmFsIGVycm9yIGRldGFpbHMgd2hlbiBjbGllbnQgZXhwb3N1cmUgaXMgZW5hYmxlZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbERlYnVnUGF5bG9hZEZvckVycm9yKHtjb25maWd1cmF0aW9uLCBlcnJvcn0pIHtcbiAgaWYgKCFjb25maWd1cmF0aW9uLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmVjb3JkTm90Rm91bmRFcnJvcikge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgaWYgKGZyb250ZW5kTW9kZWxFcnJvckhhc1ZlbG9jaW91c01ldGFkYXRhKGVycm9yKSkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgY29uc3QgZGVidWdFcnJvckNsYXNzID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5uYW1lXG4gICAgPyBlcnJvci5uYW1lXG4gICAgOiB0eXBlb2YgZXJyb3JcbiAgY29uc3QgZGVidWdFcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgPyBlcnJvci5tZXNzYWdlXG4gICAgOiBTdHJpbmcoZXJyb3IpXG4gIGNvbnN0IGRlYnVnQmFja3RyYWNlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiB0eXBlb2YgZXJyb3Iuc3RhY2sgPT09IFwic3RyaW5nXCIgJiYgZXJyb3Iuc3RhY2subGVuZ3RoID4gMFxuICAgID8gZXJyb3Iuc3RhY2suc3BsaXQoXCJcXG5cIilcbiAgICA6IHVuZGVmaW5lZFxuXG4gIHJldHVybiB7XG4gICAgZGVidWdFcnJvckNsYXNzLFxuICAgIGRlYnVnRXJyb3JNZXNzYWdlLFxuICAgIC4uLihkZWJ1Z0JhY2t0cmFjZSA/IHtkZWJ1Z0JhY2t0cmFjZX0gOiB7fSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHNlYXJjaGVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2VhcmNoZXMgLSBTZWFyY2ggcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU2VhcmNoW119IC0gTm9ybWFsaXplZCBzZWFyY2hlcy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlYXJjaGVzKHNlYXJjaGVzKSB7XG4gIGlmICghc2VhcmNoZXMpIHJldHVybiBbXVxuXG4gIGlmICghQXJyYXkuaXNBcnJheShzZWFyY2hlcykpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWFyY2hlcyB0eXBlOiAke3R5cGVvZiBzZWFyY2hlc31gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsU2VhcmNoW119ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBbXVxuXG4gIGZvciAoY29uc3Qgc2VhcmNoIG9mIHNlYXJjaGVzKSB7XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHNlYXJjaCkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlYXJjaCBlbnRyeSB0eXBlOiAke3R5cGVvZiBzZWFyY2h9YClcbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gc2VhcmNoLnBhdGhcbiAgICBjb25zdCBjb2x1bW4gPSBzZWFyY2guY29sdW1uXG4gICAgY29uc3Qgb3BlcmF0b3IgPSBzZWFyY2gub3BlcmF0b3JcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShwYXRoKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlYXJjaCBwYXRoOiBleHBlY3RlZCBhbiBhcnJheVwiKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgcGF0aEVudHJ5IG9mIHBhdGgpIHtcbiAgICAgIGlmICh0eXBlb2YgcGF0aEVudHJ5ICE9PSBcInN0cmluZ1wiIHx8IHBhdGhFbnRyeS5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwiSW52YWxpZCBzZWFyY2ggcGF0aCBlbnRyeTogZXhwZWN0ZWQgbm9uLWVtcHR5IHN0cmluZ1wiKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgY29sdW1uICE9PSBcInN0cmluZ1wiIHx8IGNvbHVtbi5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VhcmNoIGNvbHVtbjogZXhwZWN0ZWQgbm9uLWVtcHR5IHN0cmluZ1wiKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2Ygb3BlcmF0b3IgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlYXJjaCBvcGVyYXRvcjogJHtvcGVyYXRvcn1gKVxuICAgIH1cblxuICAgIGxldCBub3JtYWxpemVkT3BlcmF0b3JcblxuICAgIHRyeSB7XG4gICAgICBub3JtYWxpemVkT3BlcmF0b3IgPSBub3JtYWxpemVRdWVyeVNlYXJjaE9wZXJhdG9yKG9wZXJhdG9yKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvd0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yRm9yUGFyc2VyRXJyb3IoZXJyb3IpXG4gICAgfVxuXG4gICAgbm9ybWFsaXplZC5wdXNoKHtcbiAgICAgIGNvbHVtbixcbiAgICAgIG9wZXJhdG9yOiBub3JtYWxpemVkT3BlcmF0b3IsXG4gICAgICBwYXRoOiBbLi4ucGF0aF0sXG4gICAgICB2YWx1ZTogc2VhcmNoLnZhbHVlXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgd2hlcmUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB3aGVyZSAtIFdoZXJlIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gLSBOb3JtYWxpemVkIHdoZXJlIGhhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxXaGVyZSh3aGVyZSkge1xuICBpZiAoIXdoZXJlKSByZXR1cm4gbnVsbFxuXG4gIGlmICghaXNQbGFpbk9iamVjdCh3aGVyZSkpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCB3aGVyZSB0eXBlOiAke3R5cGVvZiB3aGVyZX1gKVxuICB9XG5cbiAgcmV0dXJuIHdoZXJlXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcmFuc2Fjay5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJhbnNhY2sgLSBSYW5zYWNrIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gLSBOb3JtYWxpemVkIFJhbnNhY2sgaGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFJhbnNhY2socmFuc2Fjaykge1xuICBpZiAoIXJhbnNhY2spIHJldHVybiBudWxsXG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHJhbnNhY2spKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgcmFuc2FjayB0eXBlOiAke3R5cGVvZiByYW5zYWNrfWApXG4gIH1cblxuICByZXR1cm4gcmFuc2Fja1xufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIGludGVnZXIgcGFyYW0uXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBpbnRlZ2VyLlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBQYXJhbSBuYW1lIGZvciBlcnJvcnMuXG4gKiBAcGFyYW0ge251bWJlcn0gbWluIC0gTWluaW11bSBhbGxvd2VkIHZhbHVlLlxuICogQHJldHVybnMge251bWJlciB8IG51bGx9IC0gTm9ybWFsaXplZCBpbnRlZ2VyLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsSW50ZWdlclBhcmFtKHZhbHVlLCBuYW1lLCBtaW4pIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCAke25hbWV9OiBleHBlY3RlZCBpbnRlZ2VyIG51bWJlcmApXG4gIH1cblxuICBpZiAodmFsdWUgPCBtaW4pIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCAke25hbWV9OiBleHBlY3RlZCB2YWx1ZSA+PSAke21pbn1gKVxuICB9XG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcGFnaW5hdGlvbi5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnaW5hdGlvbiBhcmdzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5saW1pdCAtIExpbWl0IHBheWxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLm9mZnNldCAtIE9mZnNldCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wYWdlIC0gUGFnZSBwYXlsb2FkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wZXJQYWdlIC0gUGVyLXBhZ2UgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUGFnaW5hdGlvbn0gLSBOb3JtYWxpemVkIHBhZ2luYXRpb24gZGF0YS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFBhZ2luYXRpb24oe2xpbWl0LCBvZmZzZXQsIHBhZ2UsIHBlclBhZ2V9KSB7XG4gIHJldHVybiB7XG4gICAgbGltaXQ6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0obGltaXQsIFwibGltaXRcIiwgMCksXG4gICAgb2Zmc2V0OiBub3JtYWxpemVGcm9udGVuZE1vZGVsSW50ZWdlclBhcmFtKG9mZnNldCwgXCJvZmZzZXRcIiwgMCksXG4gICAgcGFnZTogbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbShwYWdlLCBcInBhZ2VcIiwgMSksXG4gICAgcGVyUGFnZTogbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbShwZXJQYWdlLCBcInBlclBhZ2VcIiwgMSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIGRpc3RpbmN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZGlzdGluY3QgLSBEaXN0aW5jdCBwYXlsb2FkLlxuICogQHJldHVybnMge2Jvb2xlYW4gfCBudWxsfSAtIE5vcm1hbGl6ZWQgZGlzdGluY3QgZmxhZyB3aGVuIHByb3ZpZGVkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsRGlzdGluY3QoZGlzdGluY3QpIHtcbiAgaWYgKGRpc3RpbmN0ID09IG51bGwpIHJldHVybiBudWxsXG5cbiAgaWYgKHR5cGVvZiBkaXN0aW5jdCAhPT0gXCJib29sZWFuXCIpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBkaXN0aW5jdDogZXhwZWN0ZWQgYm9vbGVhbmApXG4gIH1cblxuICByZXR1cm4gZGlzdGluY3Rcbn1cblxuLyoqXG4gKiBSdW5zIGJ1aWxkIGZyb250ZW5kIG1vZGVsIGpvaW4gb2JqZWN0IGZyb20gcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSm9pbiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRnJvbnRlbmRNb2RlbEpvaW5PYmplY3RGcm9tUGF0aChwYXRoKSB7XG4gIC8qKlxuICAgKiBKb2luIG9iamVjdC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3Qgam9pbk9iamVjdCA9IHt9XG4gIC8qKlxuICAgKiBDdXJyZW50IG5vZGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGxldCBjdXJyZW50Tm9kZSA9IGpvaW5PYmplY3RcblxuICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcGF0aCkge1xuICAgIGN1cnJlbnROb2RlW3JlbGF0aW9uc2hpcE5hbWVdID0ge31cbiAgICBjdXJyZW50Tm9kZSA9IGN1cnJlbnROb2RlW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICByZXR1cm4gam9pbk9iamVjdFxufVxuXG4vKipcbiAqIEJ1aWxkIGEgc3VjY2Vzc2Z1bCBzaW5nbGUtbW9kZWwgZnJvbnRlbmQtbW9kZWwgcmVzcG9uc2UgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBtb2RlbCAtIFNlcmlhbGl6ZWQgbW9kZWwgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHt7bW9kZWw6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3RhdHVzOiBcInN1Y2Nlc3NcIn19IC0gU3VjY2VzcyByZXNwb25zZSBwYXlsb2FkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2Vzcyhtb2RlbCkge1xuICByZXR1cm4ge21vZGVsLCBzdGF0dXM6IFwic3VjY2Vzc1wifVxufVxuXG4vKipcbiAqIFJlc29sdmUgYW5kIHZhbGlkYXRlIGF0dGFjaG1lbnQgcGFyYW1zIHNoYXJlZCBieSBhdHRhY2htZW50IGNvbW1hbmRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIEZyb250ZW5kLW1vZGVsIHJlcXVlc3QgcGFyYW1zLlxuICogQHJldHVybnMge3thdHRhY2htZW50SWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgYXR0YWNobWVudE5hbWU6IHN0cmluZ30gfCBzdHJpbmd9IC0gQXR0YWNobWVudCBwYXJhbXMgb3IgdmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQXR0YWNobWVudFBhcmFtcyhwYXJhbXMpIHtcbiAgY29uc3QgYXR0YWNobWVudE5hbWUgPSBwYXJhbXMuYXR0YWNobWVudE5hbWVcblxuICBpZiAodHlwZW9mIGF0dGFjaG1lbnROYW1lICE9PSBcInN0cmluZ1wiIHx8IGF0dGFjaG1lbnROYW1lLmxlbmd0aCA8IDEpIHtcbiAgICByZXR1cm4gXCJFeHBlY3RlZCBhdHRhY2htZW50TmFtZS5cIlxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhdHRhY2htZW50SWQ6IHR5cGVvZiBwYXJhbXMuYXR0YWNobWVudElkID09PSBcInN0cmluZ1wiID8gcGFyYW1zLmF0dGFjaG1lbnRJZCA6IHVuZGVmaW5lZCxcbiAgICBhdHRhY2htZW50TmFtZVxuICB9XG59XG5cbi8qKlxuICogRXh0cmFjdCBtdXRhdGlvbiBhdHRyaWJ1dGVzIHNoYXJlZCBieSBjcmVhdGUgYW5kIHVwZGF0ZSBjb21tYW5kcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBGcm9udGVuZC1tb2RlbCByZXF1ZXN0IHBhcmFtcy5cbiAqIEByZXR1cm5zIHt7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBhdHRhY2htZW50czogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbCwgbmVzdGVkQXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gfCBzdHJpbmd9IC0gTXV0YXRpb24gYXR0cmlidXRlcyBvciB2YWxpZGF0aW9uIGVycm9yIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxNdXRhdGlvbkF0dHJpYnV0ZXMocGFyYW1zKSB7XG4gIGNvbnN0IGF0dHJpYnV0ZXMgPSBwYXJhbXMuYXR0cmlidXRlc1xuXG4gIGlmICghaXNQbGFpbk9iamVjdChhdHRyaWJ1dGVzKSkge1xuICAgIHJldHVybiBcIkV4cGVjdGVkIG1vZGVsIGF0dHJpYnV0ZXMuXCJcbiAgfVxuXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCByZWd1bGFyQXR0cmlidXRlcyA9IHt9XG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBuZXN0ZWRBdHRyaWJ1dGVzID0ge31cblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcykpIHtcbiAgICBpZiAoYXR0cmlidXRlTmFtZS5lbmRzV2l0aChcIkF0dHJpYnV0ZXNcIikpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgPSBhdHRyaWJ1dGVOYW1lLnNsaWNlKDAsIC1cIkF0dHJpYnV0ZXNcIi5sZW5ndGgpXG5cbiAgICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSkgcmV0dXJuIGBJbnZhbGlkIG5lc3RlZCBhdHRyaWJ1dGVzIGtleTogJHthdHRyaWJ1dGVOYW1lfWBcbiAgICAgIG5lc3RlZEF0dHJpYnV0ZXNbcmVsYXRpb25zaGlwTmFtZV0gPSB2YWx1ZVxuICAgIH0gZWxzZSB7XG4gICAgICByZWd1bGFyQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHZhbHVlXG4gICAgfVxuICB9XG5cbiAgaWYgKHBhcmFtcy5uZXN0ZWRBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoIWlzUGxhaW5PYmplY3QocGFyYW1zLm5lc3RlZEF0dHJpYnV0ZXMpKSByZXR1cm4gXCJFeHBlY3RlZCBuZXN0ZWRBdHRyaWJ1dGVzIHRvIGJlIGFuIG9iamVjdC5cIlxuXG4gICAgT2JqZWN0LmFzc2lnbihuZXN0ZWRBdHRyaWJ1dGVzLCBwYXJhbXMubmVzdGVkQXR0cmlidXRlcylcbiAgfVxuXG4gIGlmIChwYXJhbXMuYXR0YWNobWVudHMgIT09IHVuZGVmaW5lZCAmJiAhaXNQbGFpbk9iamVjdChwYXJhbXMuYXR0YWNobWVudHMpKSB7XG4gICAgcmV0dXJuIFwiRXhwZWN0ZWQgYXR0YWNobWVudHMgdG8gYmUgYW4gb2JqZWN0LlwiXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGF0dHJpYnV0ZXM6IHJlZ3VsYXJBdHRyaWJ1dGVzLFxuICAgIGF0dGFjaG1lbnRzOiBwYXJhbXMuYXR0YWNobWVudHMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwYXJhbXMuYXR0YWNobWVudHMsXG4gICAgbmVzdGVkQXR0cmlidXRlczogT2JqZWN0LmtleXMobmVzdGVkQXR0cmlidXRlcykubGVuZ3RoID4gMCA/IG5lc3RlZEF0dHJpYnV0ZXMgOiBudWxsXG4gIH1cbn1cblxuLyoqIENvbnRyb2xsZXIgd2l0aCBidWlsdC1pbiBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBhY3Rpb25zLiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRnJvbnRlbmRNb2RlbENvbnRyb2xsZXIgZXh0ZW5kcyBDb250cm9sbGVyIHtcbiAgLyoqXG4gICAqIEZyb250ZW5kIG1vZGVsIHBhcmFtcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxQYXJhbXMgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIEZyb250ZW5kIG1vZGVsIHBhcmFtcyBvdmVycmlkZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZSA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogRnJvbnRlbmQgbW9kZWwgYWJpbGl0eSBvdmVycmlkZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBPcmlnaW5hbCBkZXNlcmlhbGl6ZWQgY3VzdG9tLWNvbW1hbmQgY2xpZW50IHBheWxvYWQsIGNhcHR1cmVkIGJlZm9yZSByb3V0ZVxuICAgKiBmcmFtZXdvcmsgcGFyYW1zIGFyZSBtZXJnZWQgaW4sIHNvIGEgdHlwZWQgY29tbWFuZCBtZXRob2QgcmVjZWl2ZXMgdGhlIGNsaWVudCdzXG4gICAqIG93biBhcmd1bWVudHMgcmF0aGVyIHRoYW4gdGhlIHJvdXRlIG1ldGFkYXRhLiBPbmx5IHNldCBvbiB0aGUgc2hhcmVkLWVuZHBvaW50IHBhdGguXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZENsaWVudEFyZ3VtZW50cyA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogUmVxdWVzdC1zY29wZWQgY2FjaGUgZm9yIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2VzLlxuICAgKiBLZXllZCBieSBtb2RlbCBjbGFzcywgdGhlbiBieSB3aGV0aGVyIHRoZSByZXNvdXJjZSBpcyBmb3IgYSByZWxhdGVkIG1vZGVsXG4gICAqIChzbyBzZWxmLXJlZmVyZW50aWFsIHJlbGF0aW9uc2hpcHMgZG8gbm90IGFjY2lkZW50YWxseSByZXVzZSByb290IHBhcmFtcykuXG4gICAqIEB0eXBlIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxib29sZWFuLCBpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD4+IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlcyA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogT3B0aW9uYWwgcGVyLWluc3RhbmNlIGhvb2sgaW52b2tlZCBmb3IgZXZlcnkgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZVxuICAgKiByZXNvbHV0aW9uLiBJbnRlbmRlZCBmb3IgdGVzdHMgYW5kIGJlbmNobWFya3M7IGFic2VudCBpbiBwcm9kdWN0aW9uLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIERlY29kZWQgcmVxdWVzdCBwYXJhbXMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUGFyYW1zKCkge1xuICAgIGlmICh0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUpIHtcbiAgICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGVcbiAgICB9XG5cbiAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zIHx8PSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHRoaXMucGFyYW1zKCkpKVxuXG4gICAgcmV0dXJuIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZnJvbnRlbmQgbW9kZWwgcGFyYW1zLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gVGVtcG9yYXJ5IGZyb250ZW5kIG1vZGVsIHBhcmFtcy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGV4ZWN1dGVkIHdpdGggdGVtcG9yYXJ5IHBhcmFtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgd2l0aEZyb250ZW5kTW9kZWxQYXJhbXMocGFyYW1zLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHByZXZpb3VzT3ZlcnJpZGUgPSB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGVcbiAgICBjb25zdCBwcmV2aW91c1BhcmFtcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNcbiAgICBjb25zdCBwcmV2aW91c1NlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNcblxuICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZSA9IHBhcmFtc1xuICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzID0gdW5kZWZpbmVkXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlID0gcHJldmlvdXNPdmVycmlkZVxuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtcyA9IHByZXZpb3VzUGFyYW1zXG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzID0gcHJldmlvdXNTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGZyb250ZW5kIG1vZGVsIHJlcXVlc3QgY29udGV4dC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3Qtc2NvcGVkIHBhcmFtcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSByZXNwb25zZSAtIFJlc3BvbnNlIGluc3RhbmNlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZXhlY3V0ZWQgaW5zaWRlIHJlc29sdmVkIHRlbmFudCBhbmQgYWJpbGl0eSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3luYyB3aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KHBhcmFtcywgcmVzcG9uc2UsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgdGVuYW50ID0gY29uZmlndXJhdGlvbi5nZXRUZW5hbnRSZXNvbHZlcigpXG4gICAgICA/IGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgcmVxdWVzdCB0ZW5hbnQgcmVzb2x1dGlvblwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVUZW5hbnQoe1xuICAgICAgICAgICAgcGFyYW1zLFxuICAgICAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0KCksXG4gICAgICAgICAgICByZXNwb25zZVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHJlcXVlc3RcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgYWJpbGl0eSA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZUFiaWxpdHkoe1xuICAgICAgICAgIHBhcmFtcyxcbiAgICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKSxcbiAgICAgICAgICByZXNwb25zZVxuICAgICAgICB9KVxuICAgICAgICAvKipcbiAgICAgICAgICogUHJldmlvdXMgYWJpbGl0eSBvdmVycmlkZS5cbiAgICAgICAgICogQHR5cGUge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgICAgIGNvbnN0IHByZXZpb3VzQWJpbGl0eU92ZXJyaWRlID0gdGhpcy5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZVxuXG4gICAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSBhYmlsaXR5XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHByZXZpb3VzQWJpbGl0eU92ZXJyaWRlXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5IGZvciBmcm9udGVuZC1tb2RlbCByZXF1ZXN0IHNjb3BlLlxuICAgKi9cbiAgY3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgfHwgc3VwZXIuY3VycmVudEFiaWxpdHkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBGcm9udGVuZCBtb2RlbCBjbGFzcyBmb3IgY29udHJvbGxlciByZXNvdXJjZSBhY3Rpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbENsYXNzKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzRnJvbUNvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gdHlwZW9mIHBhcmFtcy5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5tb2RlbCA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gdHlwZW9mIHBhcmFtcy5jb250cm9sbGVyID09PSBcInN0cmluZ1wiID8gcGFyYW1zLmNvbnRyb2xsZXIgOiB1bmRlZmluZWRcblxuICAgIGlmIChmcm9udGVuZE1vZGVsQ2xhc3MpIHJldHVybiBmcm9udGVuZE1vZGVsQ2xhc3NcblxuICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQgbW9kZWwgY29uZmlndXJlZCBmb3IgbW9kZWwgJyR7bW9kZWxOYW1lIHx8IFwidW5rbm93blwifScgYW5kIGNvbnRyb2xsZXIgJyR7Y29udHJvbGxlck5hbWUgfHwgXCJ1bmtub3duXCJ9Jy4gRW5zdXJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcyBleGlzdHMgaW4gc3JjL3Jlc291cmNlcy8gb3IgaXMgbGlzdGVkIGluIHRoZSBhYmlsaXR5IHJlc29sdmVyLmApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2JhY2tlbmRQcm9qZWN0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uLCBtb2RlbE5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHwgbnVsbH0gLSBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBjdXJyZW50IGNvbnRyb2xsZXIuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3QgbW9kZWxOYW1lID0gdHlwZW9mIHBhcmFtcy5tb2RlbCA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5tb2RlbCA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGNvbnRyb2xsZXJOYW1lID0gdHlwZW9mIHBhcmFtcy5jb250cm9sbGVyID09PSBcInN0cmluZ1wiID8gcGFyYW1zLmNvbnRyb2xsZXIgOiB1bmRlZmluZWRcbiAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcblxuICAgICAgaWYgKG1vZGVsTmFtZSAmJiBtb2RlbE5hbWUubGVuZ3RoID4gMCAmJiByZXNvdXJjZXNbbW9kZWxOYW1lXSkge1xuICAgICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSByZXNvdXJjZXNbbW9kZWxOYW1lXVxuICAgICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24gfHwgIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlc291cmNlICcke21vZGVsTmFtZX0nIG11c3QgYmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzYClcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgICAgbW9kZWxOYW1lLFxuICAgICAgICAgIHJlc291cmNlQ2xhc3MsXG4gICAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKCFjb250cm9sbGVyTmFtZSB8fCBjb250cm9sbGVyTmFtZS5sZW5ndGggPCAxKSBjb250aW51ZVxuXG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlTW9kZWxOYW1lIGluIHJlc291cmNlcykge1xuICAgICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSByZXNvdXJjZXNbcmVzb3VyY2VNb2RlbE5hbWVdXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbiB8fCAhcmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgJyR7cmVzb3VyY2VNb2RlbE5hbWV9JyBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzc2ApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNvdXJjZVBhdGggPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgocmVzb3VyY2VNb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAodGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VNYXRjaGVzQ29udHJvbGxlcih7Y29udHJvbGxlck5hbWUsIHJlc291cmNlUGF0aH0pKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICAgICAgbW9kZWxOYW1lOiByZXNvdXJjZU1vZGVsTmFtZSxcbiAgICAgICAgICAgIHJlc291cmNlQ2xhc3MsXG4gICAgICAgICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgYmFja2VuZCBwcm9qZWN0IG1vZGVsIG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGFyZ3MuYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubW9kZWxOYW1lIC0gTW9kZWwgbmFtZS5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbiwgbW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgbW9kZWwgbmFtZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JCYWNrZW5kUHJvamVjdE1vZGVsTmFtZSh7YmFja2VuZFByb2plY3QsIG1vZGVsTmFtZX0pIHtcbiAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsTmFtZV1cblxuICAgIGlmICghcmVzb3VyY2VEZWZpbml0aW9uKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcbiAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbiB8fCAhcmVzb3VyY2VDbGFzcykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgIG1vZGVsTmFtZSxcbiAgICAgIHJlc291cmNlQ2xhc3MsXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7e2JhY2tlbmRQcm9qZWN0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uLCBtb2RlbE5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHwgbnVsbH0gLSBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVybiBudWxsXG5cbiAgICBpZiAodGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKGZyb250ZW5kTW9kZWxSZXNvdXJjZSkgPT09IG1vZGVsQ2xhc3MpIHtcbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsUmVzb3VyY2VcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe1xuICAgICAgYmFja2VuZFByb2plY3Q6IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5iYWNrZW5kUHJvamVjdCxcbiAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt7bW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9fSBmcm9udGVuZE1vZGVsUmVzb3VyY2UgLSBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gQmFja2luZyByZWNvcmQgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKGZyb250ZW5kTW9kZWxSZXNvdXJjZSkge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsYXNzIGZyb20gY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBGcm9udGVuZCBtb2RlbCBjbGFzcyByZXNvbHZlZCBmcm9tIGJhY2tlbmQgcHJvamVjdCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbENsYXNzRnJvbUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhmcm9udGVuZE1vZGVsUmVzb3VyY2UpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgZnJvbnRlbmQgbW9kZWwgY2xhc3MgYW5kIHJlcXVlc3RlZCBwcmVsb2FkIHRhcmdldCBjbGFzc2VzIGFyZSBpbml0aWFsaXplZC5cbiAgICogVGhpcyBoYW5kbGVzIHRoZSBjYXNlIHdoZXJlIG1vZGVsIGluaXRpYWxpemF0aW9uIHdhcyBza2lwcGVkIGF0IHN0YXJ0dXAgKGUuZy4sIGJyb3dzZXIgdGVzdHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBtb2RlbCBjbGFzcyBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzRnJvbUNvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFtb2RlbENsYXNzKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFJlY29yZENsYXNzSW5pdGlhbGl6ZWQobW9kZWxDbGFzcylcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFByZWxvYWRDbGFzc2VzSW5pdGlhbGl6ZWQoe1xuICAgICAgYmFja2VuZFByb2plY3Q6IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5iYWNrZW5kUHJvamVjdCxcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBwcmVsb2FkOiB0aGlzLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIHJlY29yZCBjbGFzcyBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluaXRpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG1vZGVsIGNsYXNzIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJvbnRlbmRNb2RlbFJlY29yZENsYXNzSW5pdGlhbGl6ZWQobW9kZWxDbGFzcykge1xuICAgIGlmICghbW9kZWxDbGFzcyB8fCBtb2RlbENsYXNzLmlzSW5pdGlhbGl6ZWQoKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBtb2RlbENsYXNzLmVuc3VyZUluaXRpYWxpemVkKHtjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgcHJlbG9hZCBjbGFzc2VzIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBhcmdzLmJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHdob3NlIHByZWxvYWQgdHJlZSBpcyBiZWluZyByZXNvbHZlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsfSBhcmdzLnByZWxvYWQgLSBOb3JtYWxpemVkIHByZWxvYWQgdHJlZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBwcmVsb2FkIHRhcmdldCBjbGFzc2VzIGFyZSBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyb250ZW5kTW9kZWxQcmVsb2FkQ2xhc3Nlc0luaXRpYWxpemVkKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxDbGFzcywgcHJlbG9hZH0pIHtcbiAgICBpZiAoIXByZWxvYWQpIHJldHVyblxuXG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwUHJlbG9hZF0gb2YgT2JqZWN0LmVudHJpZXMocHJlbG9hZCkpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXBQcmVsb2FkID09PSBmYWxzZSkgY29udGludWVcblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cbiAgICAgIGlmICghcmVsYXRpb25zaGlwKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHByZWxvYWQgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwVGFyZ2V0Q2xhc3NJbml0aWFsaXplZCh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICByZWxhdGlvbnNoaXBcbiAgICAgIH0pXG5cbiAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICBpZiAoaXNQbGFpbk9iamVjdChyZWxhdGlvbnNoaXBQcmVsb2FkKSAmJiBPYmplY3Qua2V5cyhyZWxhdGlvbnNoaXBQcmVsb2FkKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgbGV0IG1lc3NhZ2UgPSBgQ2Fubm90IHByZWxvYWQgbmVzdGVkIHJlbGF0aW9uc2hpcHMgdGhyb3VnaCByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSBiZWNhdXNlIGl0cyB0YXJnZXQgbW9kZWwgY2xhc3MgY291bGQgbm90IGJlIHJlc29sdmVkYFxuXG4gICAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpICYmIHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgICAgIG1lc3NhZ2UgPSBgQ2Fubm90IHByZWxvYWQgbmVzdGVkIHJlbGF0aW9uc2hpcHMgdGhyb3VnaCBwb2x5bW9ycGhpYyByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWBcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihtZXNzYWdlKVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKCFpc1BsYWluT2JqZWN0KHJlbGF0aW9uc2hpcFByZWxvYWQpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxQcmVsb2FkQ2xhc3Nlc0luaXRpYWxpemVkKHtcbiAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgIHByZWxvYWQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkfSAqLyAocmVsYXRpb25zaGlwUHJlbG9hZClcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCB0YXJnZXQgY2xhc3MgaW5pdGlhbGl6ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGFyZ3MuYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBUYXJnZXQgbW9kZWwgY2xhc3MsIHdoZW4gYXZhaWxhYmxlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldENsYXNzSW5pdGlhbGl6ZWQoe2JhY2tlbmRQcm9qZWN0LCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcC50aHJvdWdoKSB7XG4gICAgICBjb25zdCB0aHJvdWdoUmVsYXRpb25zaGlwID0gcmVsYXRpb25zaGlwLmdldE1vZGVsQ2xhc3MoKS5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwLnRocm91Z2gpXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBUYXJnZXRDbGFzc0luaXRpYWxpemVkKHtcbiAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgIHJlbGF0aW9uc2hpcDogdGhyb3VnaFJlbGF0aW9uc2hpcFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgIHJlbGF0aW9uc2hpcFxuICAgIH0pXG5cbiAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHJldHVybiBudWxsXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxSZWNvcmRDbGFzc0luaXRpYWxpemVkKHRhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVsYXRpb25zaGlwIHRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYXJncy5iYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIFRhcmdldCBtb2RlbCBjbGFzcywgd2hlbiBhdmFpbGFibGUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyh7YmFja2VuZFByb2plY3QsIHJlbGF0aW9uc2hpcH0pIHtcbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkgJiYgcmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIikgcmV0dXJuIG51bGxcblxuICAgIGlmIChyZWxhdGlvbnNoaXAua2xhc3MpIHJldHVybiByZWxhdGlvbnNoaXAua2xhc3NcblxuICAgIGlmIChyZWxhdGlvbnNoaXAuY2xhc3NOYW1lKSB7XG4gICAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JCYWNrZW5kUHJvamVjdE1vZGVsTmFtZSh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICBtb2RlbE5hbWU6IHJlbGF0aW9uc2hpcC5jbGFzc05hbWVcbiAgICAgIH0pXG4gICAgICBjb25zdCByZXNvdXJjZU1vZGVsQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPyB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKSA6IG51bGxcblxuICAgICAgaWYgKHJlc291cmNlTW9kZWxDbGFzcykgcmV0dXJuIHJlc291cmNlTW9kZWxDbGFzc1xuXG4gICAgICBjb25zdCByZWdpc3RlcmVkTW9kZWxDbGFzcyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldE1vZGVsQ2xhc3NlcygpW3JlbGF0aW9uc2hpcC5jbGFzc05hbWVdXG5cbiAgICAgIGlmIChyZWdpc3RlcmVkTW9kZWxDbGFzcykgcmV0dXJuIHJlZ2lzdGVyZWRNb2RlbENsYXNzXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIHJldHVybiB0YXJnZXRNb2RlbENsYXNzIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBjbGFzcyBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZXNvdXJjZURlZmluaXRpb24gLSBSZXNvdXJjZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgcGF0aC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIG1hdGNoZXMgY29udHJvbGxlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnRyb2xsZXJOYW1lIC0gQ29udHJvbGxlciBuYW1lIGZyb20gcGFyYW1zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVBhdGggLSBSZXNvdXJjZSBwYXRoIGZyb20gY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciByZXNvdXJjZSBwYXRoIG1hdGNoZXMgY3VycmVudCBjb250cm9sbGVyLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlTWF0Y2hlc0NvbnRyb2xsZXIoe2NvbnRyb2xsZXJOYW1lLCByZXNvdXJjZVBhdGh9KSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZENvbnRyb2xsZXIgPSBjb250cm9sbGVyTmFtZS5yZXBsYWNlKC9eXFwvK3xcXC8rJC9nLCBcIlwiKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGggPSByZXNvdXJjZVBhdGgucmVwbGFjZSgvXlxcLyt8XFwvKyQvZywgXCJcIilcblxuICAgIGlmIChub3JtYWxpemVkUmVzb3VyY2VQYXRoID09PSBub3JtYWxpemVkQ29udHJvbGxlcikgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBub3JtYWxpemVkUmVzb3VyY2VQYXRoLmVuZHNXaXRoKGAvJHtub3JtYWxpemVkQ29udHJvbGxlcn1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gLSBCYWNrZW5kIHJlc291cmNlIGluc3RhbmNlIGZvciBjdXJyZW50IGZyb250ZW5kLW1vZGVsIGFjdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyICcke3RoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLmNvbnRyb2xsZXJ9J2ApXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VBcmdzID0ge1xuICAgICAgYWJpbGl0eTogdGhpcy5jdXJyZW50QWJpbGl0eSgpLFxuICAgICAgY29udHJvbGxlcjogdGhpcyxcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgLi4uKHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0Q29udGV4dCgpIHx8IHt9KSxcbiAgICAgICAgcGFyYW1zOiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0KClcbiAgICAgIH0sXG4gICAgICBsb2NhbHM6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgbW9kZWxOYW1lOiBmcm9udGVuZE1vZGVsUmVzb3VyY2UubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvblxuICAgIH1cblxuICAgIHJldHVybiBuZXcgZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3MocmVzb3VyY2VBcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gRnJvbnRlbmQgbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnByaW1hcnlLZXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYWJpbGl0eSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYmlsaXR5IGFjdGlvbiBjb25maWd1cmVkIGZvciB0aGUgZnJvbnRlbmQgYWN0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIGNvbnRyb2xsZXIgJyR7dGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuY29udHJvbGxlcn0nYClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXRpZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uLmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSAnJHtmcm9udGVuZE1vZGVsUmVzb3VyY2UubW9kZWxOYW1lfScgbXVzdCBkZWZpbmUgYW4gJ2FiaWxpdGllcycgb2JqZWN0YClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXR5S2V5ID0gYWN0aW9uID09PSBcImF0dGFjaFwiXG4gICAgICA/IFwidXBkYXRlXCJcbiAgICAgIDogKChhY3Rpb24gPT09IFwiZG93bmxvYWRcIiB8fCBhY3Rpb24gPT09IFwidXJsXCIgfHwgYWN0aW9uID09PSBcImF0dGFjaG1lbnRMaXN0XCIpID8gXCJmaW5kXCIgOiBhY3Rpb24pXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IGFiaWxpdGllc1thYmlsaXR5S2V5XVxuXG4gICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFiaWxpdHlBY3Rpb24ubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSAnJHtmcm9udGVuZE1vZGVsUmVzb3VyY2UubW9kZWxOYW1lfScgbXVzdCBkZWZpbmUgYWJpbGl0aWVzLiR7YWJpbGl0eUtleX1gKVxuICAgIH1cblxuICAgIHJldHVybiBhYmlsaXR5QWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBhYmlsaXR5IGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCBxdWVyeSBmb3IgdGhlIGFjdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxBYmlsaXR5QXV0aG9yaXplZFF1ZXJ5KGFjdGlvbikge1xuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSB0aGlzLmZyb250ZW5kTW9kZWxBYmlsaXR5QWN0aW9uKGFjdGlvbilcblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbiwgdGhpcy5jdXJyZW50QWJpbGl0eSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXV0aG9yaXplZCBxdWVyeS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBBdXRob3JpemVkIHF1ZXJ5IGZvciB0aGUgYWN0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShhY3Rpb24pIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKHJlc291cmNlLmF1dGhvcml6ZWRRdWVyeSAhPT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUuYXV0aG9yaXplZFF1ZXJ5KSB7XG4gICAgICByZXR1cm4gcmVzb3VyY2UuYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeShhY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQcmltYXJ5IGtleSB2YWx1ZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiBtb2RlbC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml6ZWQgaWRlbnRpdGllcyBmcm9tIGEgY2FuZGlkYXRlIGNvaG9ydCB3aXRob3V0IHBlci1yZWNvcmQgcXVlcmllcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZVtdfSBhcmdzLmlkZW50aXRpZXMgLSBDYW5kaWRhdGUgaWRlbnRpdGllcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBpZGVudGl0eSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gYXJncy5wcmltYXJ5S2V5IC0gSWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBhcmdzLnF1ZXJ5IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2V0PHN0cmluZz4+fSAtIENhbm9uaWNhbCBhdXRob3JpemVkIGlkZW50aXR5IGtleXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQXV0aG9yaXplZElkZW50aXR5U2V0KHtpZGVudGl0aWVzLCBtb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBxdWVyeX0pIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWRJZHMgPSBhd2FpdCBxdWVyeVxuICAgICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogaWRlbnRpdGllc30pXG4gICAgICAgIC5wbHVjayhwcmltYXJ5S2V5KVxuXG4gICAgICByZXR1cm4gbmV3IFNldChhdXRob3JpemVkSWRzLm1hcCgodmFsdWUpID0+IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHZhbHVlKSkpXG4gICAgfVxuXG4gICAgY29uc3QgY29ob3J0cyA9IHF1ZXJ5LmRyaXZlci5jaHVua1ZhbHVlcyhpZGVudGl0aWVzLCAoY29ob3J0KSA9PiBxdWVyeVxuICAgICAgLmNsb25lKClcbiAgICAgIC53aGVyZShjb21wb3NpdGVNb2RlbFByaW1hcnlLZXlDb2hvcnRTcWwoe21vZGVsQ2xhc3MsIHByaW1hcnlLZXksIHF1ZXJ5LCB2YWx1ZXM6IGNvaG9ydH0pKVxuICAgICAgLnRvU3FsKCkpXG4gICAgY29uc3QgYXV0aG9yaXplZElkZW50aXR5S2V5cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBjb2hvcnQgb2YgY29ob3J0cykge1xuICAgICAgY29uc3QgYXV0aG9yaXplZE1vZGVscyA9IGF3YWl0IHF1ZXJ5XG4gICAgICAgIC5jbG9uZSgpXG4gICAgICAgIC53aGVyZShjb21wb3NpdGVNb2RlbFByaW1hcnlLZXlDb2hvcnRTcWwoe21vZGVsQ2xhc3MsIHByaW1hcnlLZXksIHF1ZXJ5LCB2YWx1ZXM6IGNvaG9ydH0pKVxuICAgICAgICAudG9BcnJheSgpXG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgYXV0aG9yaXplZE1vZGVscykge1xuICAgICAgICBjb25zdCBpZGVudGl0eSA9IHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcblxuICAgICAgICBhdXRob3JpemVkSWRlbnRpdHlLZXlzLmFkZChtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZGVudGl0eSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF1dGhvcml6ZWRJZGVudGl0eUtleXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGZpbHRlciBhdXRob3JpemVkIG1vZGVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5tb2RlbHMgLSBDYW5kaWRhdGUgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIEF1dGhvcml6ZWQgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbiwgbW9kZWxzfSkge1xuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm4gbW9kZWxzXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG5cbiAgICBjb25zdCBpZGVudGl0aWVzID0gbW9kZWxzLm1hcCgobW9kZWwpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlWYWx1ZShtb2RlbCkpXG4gICAgY29uc3QgYXV0aG9yaXplZElkcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRJZGVudGl0eVNldCh7XG4gICAgICBpZGVudGl0aWVzLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSxcbiAgICAgIHByaW1hcnlLZXksXG4gICAgICBxdWVyeTogdGhpcy5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1vZGVscy5maWx0ZXIoKG1vZGVsKSA9PiBhdXRob3JpemVkSWRzLmhhcyhtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gZnJvbnRlbmQgbW9kZWwgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjdGlvbiBzaG91bGQgY29udGludWUuXG4gICAqL1xuICBhc3luYyBydW5Gcm9udGVuZE1vZGVsQmVmb3JlQWN0aW9uKGFjdGlvbikge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5iZWZvcmVBY3Rpb24oYWN0aW9uKVxuXG4gICAgcmV0dXJuIHJlc3VsdCAhPT0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGZpbmQgcmVjb3JkLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIExvY2F0ZWQgbW9kZWwgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoYWN0aW9uLCBpZCkge1xuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLmZpbmQoYWN0aW9uLCBpZClcblxuICAgIGlmICghbW9kZWwpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBhdXRob3JpemVkTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyQXV0aG9yaXplZE1vZGVscyh7YWN0aW9uLCBtb2RlbHM6IFttb2RlbF19KVxuXG4gICAgcmV0dXJuIGF1dGhvcml6ZWRNb2RlbHNbMF0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY3JlYXRlIHJlY29yZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBDcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBbbmVzdGVkQXR0cmlidXRlc10gLSBPcHRpb25hbCBuZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQgZm9yIGNhc2NhZGluZyB3cml0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW2F0dGFjaG1lbnRzXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgcGF5bG9hZHMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gQ3JlYXRlZCBtb2RlbCB3aGVuIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ3JlYXRlUmVjb3JkKGF0dHJpYnV0ZXMsIG5lc3RlZEF0dHJpYnV0ZXMgPSBudWxsLCBhdHRhY2htZW50cyA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgcmVzb3VyY2UuY3JlYXRlKGF0dHJpYnV0ZXMsIHthdHRhY2htZW50cywgbmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlcjogdGhpc30pXG5cbiAgICBjb25zdCBhdXRob3JpemVkTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyQXV0aG9yaXplZE1vZGVscyh7YWN0aW9uOiBcImNyZWF0ZVwiLCBtb2RlbHM6IFttb2RlbF19KVxuXG4gICAgaWYgKGF1dGhvcml6ZWRNb2RlbHMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGF1dGhvcml6ZWRNb2RlbHNbMF1cbiAgICB9XG5cbiAgICBhd2FpdCByZXNvdXJjZS5oYW5kbGVVbmF1dGhvcml6ZWRDcmVhdGVkTW9kZWwobW9kZWwpXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBGcm9udGVuZCBtb2RlbCByZWNvcmRzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbFJlY29yZHMoKSB7XG4gICAgY29uc3QgbW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnJlY29yZHMoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbjogXCJpbmRleFwiLCBtb2RlbHN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcHJlbG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGx9IC0gRnJvbnRlbmQgcHJlbG9hZCBkYXRhLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByZWxvYWQoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQcmVsb2FkKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnByZWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gfCBudWxsfSAtIEZyb250ZW5kIHNlbGVjdCBkYXRhLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdCgpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlbGVjdCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5zZWxlY3QsIHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3RzIGV4dHJhLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHwgbnVsbH0gLSBGcm9udGVuZCBleHRyYS1zZWxlY3QgZGF0YSAoZGVmYXVsdHMgcGx1cyB0aGVzZSksIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsU2VsZWN0KHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnNlbGVjdHNFeHRyYSwgdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHNlYXJjaGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAtIEZyb250ZW5kIHNlYXJjaCBmaWx0ZXJzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlYXJjaGVzKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsU2VhcmNoZXModGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuc2VhcmNoZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCB3aGVyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gRnJvbnRlbmQgd2hlcmUgZmlsdGVycy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxXaGVyZSgpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLndoZXJlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmFuc2Fjay5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gRnJvbnRlbmQgUmFuc2FjayBmaWx0ZXJzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJhbnNhY2soKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSYW5zYWNrKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnJhbnNhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBqb2lucy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gRnJvbnRlbmQgam9pbnMgZGVzY3JpcHRvcnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSm9pbnMoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxKb2lucyh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5qb2lucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHNvcnQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU29ydFtdfSAtIEZyb250ZW5kIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU29ydCgpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZVF1ZXJ5U29ydCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5zb3J0KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGdyb3VwLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEdyb3VwW119IC0gRnJvbnRlbmQgZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsR3JvdXAoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBub3JtYWxpemVRdWVyeUdyb3VwKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLmdyb3VwKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBhZ2luYXRpb24uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUGFnaW5hdGlvbn0gLSBGcm9udGVuZCBwYWdpbmF0aW9uIHBhcmFtcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG5cbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFBhZ2luYXRpb24oe1xuICAgICAgbGltaXQ6IHBhcmFtcy5saW1pdCxcbiAgICAgIG9mZnNldDogcGFyYW1zLm9mZnNldCxcbiAgICAgIHBhZ2U6IHBhcmFtcy5wYWdlLFxuICAgICAgcGVyUGFnZTogcGFyYW1zLnBlclBhZ2VcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZGlzdGluY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgbnVsbH0gLSBGcm9udGVuZCBkaXN0aW5jdCBmbGFnIHdoZW4gcHJvdmlkZWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRGlzdGluY3QoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxEaXN0aW5jdCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5kaXN0aW5jdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBsdWNrLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBsdWNrW119IC0gRnJvbnRlbmQgcGx1Y2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUGx1Y2soKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBsdWNrID0gbm9ybWFsaXplUXVlcnlQbHVjayh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5wbHVjaylcblxuICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUGx1Y2tEZWZpbml0aW9uc0FsbG93ZWQocGx1Y2spXG5cbiAgICAgIHJldHVybiBwbHVja1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvdW50IHJlcXVlc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCBhc2tzIGZvciBhbiBhZ2dyZWdhdGUgY291bnQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ291bnRSZXF1ZXN0ZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLmNvdW50ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCB3aXRoIGNvdW50LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fVxuICAgKiAgIEZyb250ZW5kIHdpdGhDb3VudCBlbnRyaWVzLiBFbXB0eSBhcnJheSB3aGVuIG5vdCByZXF1ZXN0ZWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsV2l0aENvdW50KCkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLndpdGhDb3VudFxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBbXVxuXG4gICAgLyoqXG4gICAgICogRW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiByYXcpIHtcbiAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiKSBjb250aW51ZVxuICAgICAgaWYgKHR5cGVvZiBlbnRyeS5hdHRyaWJ1dGVOYW1lICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5LmF0dHJpYnV0ZU5hbWUubGVuZ3RoID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKHR5cGVvZiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUubGVuZ3RoID09PSAwKSBjb250aW51ZVxuXG4gICAgICBlbnRyaWVzLnB1c2goe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBlbnRyeS5hdHRyaWJ1dGVOYW1lLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lOiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICB3aGVyZTogZW50cnkud2hlcmUgJiYgdHlwZW9mIGVudHJ5LndoZXJlID09PSBcIm9iamVjdFwiID8gZW50cnkud2hlcmUgOiB1bmRlZmluZWRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlIGFuIGVudHJ5IGZyb20gdGhlIGZyb250ZW5kLW1vZGVsIGBhYmlsaXRpZXNgIHBheWxvYWQgdG9cbiAgICogaXRzIGJhY2tlbmQgbW9kZWwgY2xhc3MgYnkgbG9va2luZyB1cCB0aGUgcmVzb3VyY2UgYnkgbW9kZWxOYW1lXG4gICAqIGFjcm9zcyBhbGwgY29uZmlndXJlZCBiYWNrZW5kIHByb2plY3RzLiBSZXR1cm5zIG51bGwgd2hlbiBub1xuICAgKiByZXNvdXJjZSBtYXRjaGVzIHRoZSB1c2VyLXByb3ZpZGVkIGFiaWxpdHkgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBuYW1lIGZyb20gYW4gYWJpbGl0eSByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIEJhY2tlbmQgbW9kZWwgY2xhc3MgZXhwb3NlZCB1bmRlciB0aGF0IGZyb250ZW5kIG5hbWUsIGlmIHByZXNlbnQuXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENsYXNzRm9yQWJpbGl0aWVzKG1vZGVsTmFtZSkge1xuICAgIGlmICh0eXBlb2YgbW9kZWxOYW1lICE9PSBcInN0cmluZ1wiIHx8IG1vZGVsTmFtZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3QgZnJvbnRlbmRNb2RlbHMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSBmcm9udGVuZE1vZGVsc1ttb2RlbE5hbWVdXG5cbiAgICAgIGlmICghcmVzb3VyY2VEZWZpbml0aW9uKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCAnJHttb2RlbE5hbWV9JyByZXNvdXJjZSBkZWZpbml0aW9uIG11c3QgYmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzLmApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdCBldmVyeSBsb2FkZWQgcmVjb3JkIHdob3NlIGBnZXRNb2RlbE5hbWUoKWAgbWF0Y2hlcyB0aGVcbiAgICogcmVxdWVzdGVkIG5hbWUsIHdhbGtpbmcgYWNyb3NzIHRoZSByb290LWxldmVsIHNsaWNlIHBsdXMgYW55XG4gICAqIHByZWxvYWRlZCByZWxhdGlvbnNoaXBzIGF0IGFueSBkZXB0aC4gVXNlZCB0byBldmFsdWF0ZSBwZXItcmVjb3JkXG4gICAqIGFiaWxpdGllcyBhZ2FpbnN0IG5lc3RlZCBwcmVsb2FkZWQgY2hpbGRyZW4gd2l0aCBhIHNpbmdsZSBiYXRjaGVkXG4gICAqIHF1ZXJ5IHBlciAobW9kZWxDbGFzcywgYWN0aW9uKSBwYWlyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gcm9vdE1vZGVscyAtIExvYWRlZCByb290cyB3aG9zZSByZWxhdGlvbnNoaXAgZ3JhcGhzIHNob3VsZCBiZSB0cmF2ZXJzZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBuYW1lIHJlY29yZHMgbXVzdCBtYXRjaC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gLSBNYXRjaGluZyByZWNvcmRzIHJlYWNoYWJsZSBmcm9tIHRoZSBsb2FkZWQgcm9vdHMuXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENvbGxlY3RSZWNvcmRzRm9yTmFtZShyb290TW9kZWxzLCBtb2RlbE5hbWUpIHtcbiAgICAvKipcbiAgICAgKiBPdXQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBvdXQgPSBbXVxuICAgIC8qKlxuICAgICAqIFNlZW4uXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBzZWVuID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBXYWxrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGwgfCB1bmRlZmluZWR9IHJlY29yZCAtIExvYWRlZCByZWNvcmQgd2hvc2UgcmVsYXRpb25zaGlwIGdyYXBoIHNob3VsZCBiZSB2aXNpdGVkLlxuICAgICAqL1xuICAgIGNvbnN0IHdhbGsgPSAocmVjb3JkKSA9PiB7XG4gICAgICBpZiAoIXJlY29yZCB8fCB0eXBlb2YgcmVjb3JkICE9PSBcIm9iamVjdFwiKSByZXR1cm5cbiAgICAgIGlmIChzZWVuLmhhcyhyZWNvcmQpKSByZXR1cm5cbiAgICAgIHNlZW4uYWRkKHJlY29yZClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlY29yZC5nZXRNb2RlbENsYXNzKClcbiAgICAgIGlmIChNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpID09PSBtb2RlbE5hbWUpIHtcbiAgICAgICAgb3V0LnB1c2gocmVjb3JkKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBzTWFwID0gTW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcblxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKHJlbGF0aW9uc2hpcHNNYXApKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlY29yZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgY29uc3QgbG9hZGVkID0gcmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcbiAgICAgICAgaWYgKGxvYWRlZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGxvYWRlZCkgd2FsayhjaGlsZClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3YWxrKGxvYWRlZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgcm9vdCBvZiByb290TW9kZWxzKSB3YWxrKHJvb3QpXG5cbiAgICByZXR1cm4gb3V0XG4gIH1cblxuICAvKipcbiAgICogRXZhbHVhdGUgZXZlcnkgYWJpbGl0eSByZXF1ZXN0ZWQgdmlhIHRoZSBmcm9udGVuZCBgYWJpbGl0aWVzYFxuICAgKiBwYXJhbSBhZ2FpbnN0IHRoZSBsb2FkZWQgbW9kZWwgY29ob3J0IChwbHVzIGFueSBwcmVsb2FkZWRcbiAgICogY2hpbGRyZW4pLCBhdHRhY2hpbmcgdGhlIHJlc3VsdHMgdG8gZWFjaCByZWNvcmQgdmlhXG4gICAqIGBfc2V0Q29tcHV0ZWRBYmlsaXR5YC4gUnVucyBvbmUgYmF0Y2hlZCBgYXV0aG9yaXplZCBxdWVyeSArIHBsdWNrYFxuICAgKiBwZXIgKG1vZGVsQ2xhc3MsIGFjdGlvbikgcGFpciwgcmVnYXJkbGVzcyBvZiBob3cgbWFueSByZWNvcmRzXG4gICAqIHdlcmUgbG9hZGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gcm9vdE1vZGVscyAtIExvYWRlZCByb290cyB0aGF0IHJlY2VpdmUgY29tcHV0ZWQgYWJpbGl0eSByZXN1bHRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKHJvb3RNb2RlbHMpIHtcbiAgICBjb25zdCBlbnRyaWVzID0gdGhpcy5mcm9udGVuZE1vZGVsQWJpbGl0aWVzKClcbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVyblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyb290TW9kZWxzKSB8fCByb290TW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDbGFzc0ZvckFiaWxpdGllcyhlbnRyeS5tb2RlbE5hbWUpXG4gICAgICBpZiAoIW1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29sbGVjdFJlY29yZHNGb3JOYW1lKHJvb3RNb2RlbHMsIGVudHJ5Lm1vZGVsTmFtZSlcbiAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgY29udGludWVcblxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIGVudHJ5LmFjdGlvbnMpIHtcbiAgICAgICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICAgICAgbGV0IGFsbG93ZWRJZHNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBhdXRob3JpemVkUXVlcnkgPSBtb2RlbENsYXNzLmFjY2Vzc2libGVGb3IoYWN0aW9uLCBhYmlsaXR5KVxuXG4gICAgICAgICAgY29uc3QgaWRlbnRpdGllcyA9IGNhbmRpZGF0ZXMubWFwKChyZWNvcmQpID0+IHJlY29yZC5pZCgpKVxuXG4gICAgICAgICAgYWxsb3dlZElkcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRJZGVudGl0eVNldCh7XG4gICAgICAgICAgICBpZGVudGl0aWVzLFxuICAgICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICAgIHByaW1hcnlLZXksXG4gICAgICAgICAgICBxdWVyeTogYXV0aG9yaXplZFF1ZXJ5XG4gICAgICAgICAgfSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBBbiBhYmlsaXR5IHdpdGggbm8gYWxsb3cgcnVsZXMgZm9yIHRoZSBhY3Rpb24gdGhyb3dzIHZpYVxuICAgICAgICAgIC8vIGBhY2Nlc3NpYmxlRm9yYDsgdHJlYXQgYXMgYSB1bml2ZXJzYWwgZGVueSBzbyB0aGUgZnJvbnRlbmRcbiAgICAgICAgICAvLyBnZXRzIGBjYW4oYWN0aW9uKSA9PT0gZmFsc2VgIGZvciBldmVyeSBjYW5kaWRhdGUsIGluc3RlYWRcbiAgICAgICAgICAvLyBvZiBzdXJmYWNpbmcgYW4gZXJyb3IgdGhhdCB0aGUgVUkgY2FuJ3QgYWN0IG9uLlxuICAgICAgICAgIHZvaWQgZXJyb3JcbiAgICAgICAgICBhbGxvd2VkSWRzID0gbmV3IFNldCgpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgICAgY29uc3QgaWRWYWx1ZSA9IHJlY29yZC5pZCgpXG4gICAgICAgICAgY29uc3QgYWxsb3dlZCA9IGFsbG93ZWRJZHMuaGFzKG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIGlkVmFsdWUpKVxuICAgICAgICAgIHJlY29yZC5fc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgYWxsb3dlZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSB0aGUgZnJvbnRlbmQtbW9kZWwgYGFiaWxpdGllc2AgcGFyYW0gaW50byBhIGxpc3Qgb2ZcbiAgICogYHttb2RlbE5hbWUsIGFjdGlvbnN9YCBlbnRyaWVzIHRvIGV2YWx1YXRlIGFnYWluc3QgbG9hZGVkIHJlY29yZHMuXG4gICAqIFVua25vd24gZW50cmllcyBhcmUgc2lsZW50bHkgc2tpcHBlZCDigJQgZG93bnN0cmVhbSBjb2RlIHJlc29sdmVzXG4gICAqIG1vZGVsIG5hbWVzIHRvIGNsYXNzZXMgd2hlbiBhcHBseWluZyB0aGUgY2hlY2ssIHNvIHVucmVzb2x2ZWRcbiAgICogbmFtZXMgbmF0dXJhbGx5IGJlY29tZSBuby1vcHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59IC0gTm9ybWFsaXplZCBtb2RlbCBhYmlsaXR5IHJlcXVlc3RzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEFiaWxpdGllcygpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5hYmlsaXRpZXNcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIEVudHJpZXMuXG4gICAgICogQHR5cGUge0FycmF5PHttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119Pn0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmF3KSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIikgY29udGludWVcbiAgICAgIGlmICh0eXBlb2YgZW50cnkubW9kZWxOYW1lICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5Lm1vZGVsTmFtZS5sZW5ndGggPT09IDApIGNvbnRpbnVlXG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZW50cnkuYWN0aW9ucykpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGFjdGlvbnMgPSBlbnRyeS5hY3Rpb25zLmZpbHRlcihcbiAgICAgICAgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGFjdGlvbikgPT4gdHlwZW9mIGFjdGlvbiA9PT0gXCJzdHJpbmdcIiAmJiBhY3Rpb24ubGVuZ3RoID4gMFxuICAgICAgKVxuXG4gICAgICBpZiAoYWN0aW9ucy5sZW5ndGggPT09IDApIGNvbnRpbnVlXG5cbiAgICAgIGVudHJpZXMucHVzaCh7YWN0aW9ucywgbW9kZWxOYW1lOiBlbnRyeS5tb2RlbE5hbWV9KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzXG4gIH1cblxuICAvKipcbiAgICogUmVhZCB0aGUgZnJvbnRlbmQtbW9kZWwgYHF1ZXJ5RGF0YWAgcGFyYW0uIFRoZSB3aXJlIGZvcm1hdCBjYXJyaWVzXG4gICAqIG9ubHkgKipuYW1lcyoqICh0aGUga2V5cyB0aGUgZnJvbnRlbmQgd2FudHMgYXR0YWNoZWQpIHBsdXMgdGhlXG4gICAqIG9wdGlvbmFsIG5lc3RlZC1yZWxhdGlvbnNoaXAgY2hhaW4gbGVhZGluZyB0byB0aGVtIOKAlCB0aGUgYWN0dWFsIFNRTFxuICAgKiBmcmFnbWVudHMgbGl2ZSBvbiB0aGUgYmFja2VuZCBtb2RlbCBhcyBgTW9kZWwucXVlcnlEYXRhKG5hbWUsIGZuKWBcbiAgICogcmVnaXN0cmF0aW9ucy4gQ2FsbGVycyBjYW5ub3QgcHVzaCBTUUwgdGhyb3VnaCB0aGlzIGVuZHBvaW50LlxuICAgKlxuICAgKiBSZXR1cm5zIHRoZSByYXcgbmVzdGVkLXJlY29yZCBzcGVjIChzaGFwZSB2YWxpZGF0ZWQgYnkgdGhlXG4gICAqIG5vcm1hbGl6ZXIgaW5zaWRlIGBRdWVyeS5xdWVyeURhdGFgKSBvciBgbnVsbGAgd2hlbiBub3QgcmVxdWVzdGVkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YVNwZWMgfCBudWxsfSAtIE5vcm1hbGl6ZWQgcXVlcnktZGF0YSBzcGVjaWZpY2F0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5xdWVyeURhdGFcblxuICAgIGlmIChyYXcgPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKSByZXR1cm4gcmF3XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhd1xuICAgIGlmICh0eXBlb2YgcmF3ID09PSBcIm9iamVjdFwiKSByZXR1cm4gcmF3XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEluZGV4UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBJbmRleCBxdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSAtIEZyb250ZW5kIGluZGV4IHF1ZXJ5IHdpdGggbm9ybWFsaXplZCBwYXJhbXMgYXBwbGllZC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtpbmNsdWRlUGFnaW5hdGlvbiA9IHRydWUsIGluY2x1ZGVTb3J0ID0gdHJ1ZSwgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKCl9ID0gb3B0aW9uc1xuICAgIGxldCBxdWVyeSA9IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImluZGV4XCIpXG4gICAgY29uc3QgcHJlbG9hZCA9IHRoaXMuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuXG4gICAgaWYgKHByZWxvYWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuICAgIH1cblxuICAgIGNvbnN0IGpvaW5zID0gdGhpcy5mcm9udGVuZE1vZGVsSm9pbnMoKVxuICAgIGNvbnN0IHdoZXJlID0gdGhpcy5mcm9udGVuZE1vZGVsV2hlcmUoKVxuICAgIGNvbnN0IHBhZ2luYXRpb24gPSB0aGlzLmZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKClcbiAgICBjb25zdCBkaXN0aW5jdCA9IHRoaXMuZnJvbnRlbmRNb2RlbERpc3RpbmN0KClcblxuICAgIGlmIChpbmNsdWRlUGFnaW5hdGlvbikge1xuICAgICAgcmVzb3VyY2UuYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uKHtjb250cm9sbGVyOiB0aGlzLCBwYWdpbmF0aW9uLCBxdWVyeX0pXG4gICAgfVxuXG4gICAgaWYgKGRpc3RpbmN0ICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5kaXN0aW5jdChkaXN0aW5jdClcbiAgICB9XG5cbiAgICBpZiAod2hlcmUpIHtcbiAgICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pXG4gICAgfVxuXG4gICAgY29uc3QgcmFuc2FjayA9IHRoaXMuZnJvbnRlbmRNb2RlbFJhbnNhY2soKVxuXG4gICAgaWYgKHJhbnNhY2spIHtcbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBbGxvd2VkKHJhbnNhY2spXG4gICAgICBxdWVyeS5yYW5zYWNrKHJhbnNhY2spXG4gICAgfVxuXG4gICAgaWYgKGpvaW5zKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuICAgIH1cblxuICAgIGNvbnN0IHNlYXJjaGVzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoZXMoKVxuXG4gICAgZm9yIChjb25zdCBzZWFyY2ggb2Ygc2VhcmNoZXMpIHtcbiAgICAgIHJlc291cmNlLmFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoKHtjb250cm9sbGVyOiB0aGlzLCBxdWVyeSwgc2VhcmNofSlcbiAgICB9XG5cbiAgICBjb25zdCBncm91cHMgPSB0aGlzLmZyb250ZW5kTW9kZWxHcm91cCgpXG5cbiAgICBpZiAoZ3JvdXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsUm9vdEdyb3VwQ29sdW1ucyh7cXVlcnl9KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEdyb3VwKHtncm91cCwgcXVlcnl9KVxuICAgIH1cblxuICAgIGNvbnN0IHNvcnRzID0gdGhpcy5mcm9udGVuZE1vZGVsU29ydCgpXG5cbiAgICBpZiAoaW5jbHVkZVNvcnQgJiYgc29ydHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBzb3J0IG9mIHNvcnRzKSB7XG4gICAgICAgIHJlc291cmNlLmFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydCh7Y29udHJvbGxlcjogdGhpcywgcXVlcnksIHNvcnR9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHdpdGhDb3VudCA9IHRoaXMuZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHdpdGhDb3VudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBTcGVjLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCB7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3Qgc3BlYyA9IHt9XG4gICAgICBzcGVjW2VudHJ5LmF0dHJpYnV0ZU5hbWVdID0ge3JlbGF0aW9uc2hpcDogZW50cnkucmVsYXRpb25zaGlwTmFtZSwgd2hlcmU6IGVudHJ5LndoZXJlfVxuICAgICAgcXVlcnkud2l0aENvdW50KHNwZWMpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnlEYXRhID0gdGhpcy5mcm9udGVuZE1vZGVsUXVlcnlEYXRhKClcblxuICAgIGlmIChxdWVyeURhdGEgIT0gbnVsbCkge1xuICAgICAgcXVlcnkucXVlcnlEYXRhKHF1ZXJ5RGF0YSlcbiAgICB9XG5cbiAgICBxdWVyeSA9IHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsVHJhbnNsYXRlZEF0dHJpYnV0ZVByZWxvYWRzKHtxdWVyeX0pXG5cbiAgICBpZiAocXVlcnkuX2Rpc3RpbmN0ICYmIHF1ZXJ5LmRyaXZlci5nZXRUeXBlKCkgPT09IFwibXNzcWxcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbE1zc3FsRGlzdGluY3RCeVByaW1hcnlLZXlRdWVyeSh7cXVlcnl9KVxuICAgIH1cblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIE1TU1FMIGNhbm5vdCBhcHBseSBESVNUSU5DVCBvdmVyIG5vbi1jb21wYXJhYmxlIHRleHQgY29sdW1ucyBpbiB0YWJsZS4qIHNlbGVjdHMuXG4gICAqIFRoaXMgcmV3cml0ZXMgZGlzdGluY3QgZnJvbnRlbmQtbW9kZWwgcXVlcmllcyB0byBzZWxlY3Qgcm9vdCByZWNvcmRzIGJ5IGRpc3RpbmN0IFBLIHN1YnF1ZXJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgd2l0aCBkaXN0aW5jdCBhbmQgZmlsdGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gLSBNU1NRTC1zYWZlIGRpc3RpbmN0IHF1ZXJ5LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbE1zc3FsRGlzdGluY3RCeVByaW1hcnlLZXlRdWVyeSh7cXVlcnl9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBcIk1TU1FMIGRpc3RpbmN0IGZyb250ZW5kLW1vZGVsIHF1ZXJpZXNcIilcbiAgICBjb25zdCByb290VGFibGVTcWwgPSBxdWVyeS5kcml2ZXIucXVvdGVUYWJsZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICAgIGNvbnN0IHByaW1hcnlLZXlTcWwgPSBgJHtyb290VGFibGVTcWx9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpfWBcbiAgICBjb25zdCBkaXN0aW5jdElkc1F1ZXJ5ID0gcXVlcnkuY2xvbmUoKVxuXG4gICAgZGlzdGluY3RJZHNRdWVyeS5fcHJlbG9hZCA9IHt9XG4gICAgZGlzdGluY3RJZHNRdWVyeS5fc2VsZWN0cyA9IFtdXG4gICAgZGlzdGluY3RJZHNRdWVyeS5zZWxlY3QocHJpbWFyeUtleVNxbClcbiAgICBkaXN0aW5jdElkc1F1ZXJ5LmRpc3RpbmN0KHRydWUpXG5cbiAgICBjb25zdCBkaXN0aW5jdFJvb3RRdWVyeSA9IG1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcblxuICAgIGRpc3RpbmN0Um9vdFF1ZXJ5LndoZXJlKGAke3ByaW1hcnlLZXlTcWx9IElOICgke2Rpc3RpbmN0SWRzUXVlcnkudG9TcWwoKX0pYClcbiAgICBkaXN0aW5jdFJvb3RRdWVyeS5fcHJlbG9hZCA9IHsuLi5xdWVyeS5fcHJlbG9hZH1cblxuICAgIHJldHVybiBkaXN0aW5jdFJvb3RRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGx1Y2sgdmFsdWVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBsdWNrIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFBsdWNrW119IGFyZ3MucGx1Y2sgLSBQbHVjayBkZXNjcmlwdG9ycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQbHVja2VkIHZhbHVlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxQbHVja1ZhbHVlcyh7cXVlcnksIHBsdWNrfSkge1xuICAgIGlmIChwbHVjay5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb2x1bW5zIGdpdmVuIHRvIHBsdWNrXCIpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBwbHVja1F1ZXJ5ID0gcXVlcnkuY2xvbmUoKVxuICAgIC8qKlxuICAgICAqIEFsaWFzZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGFsaWFzZXMgPSBbXVxuICAgIGNvbnN0IHF1ZXJ5TWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShxdWVyeSlcbiAgICBjb25zdCBwbHVja1F1ZXJ5TWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShwbHVja1F1ZXJ5KVxuICAgIGNvbnN0IGpvaW5lZFBhdGhzID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdXG5cbiAgICBwbHVja1F1ZXJ5Ll9wcmVsb2FkID0ge31cbiAgICBwbHVja1F1ZXJ5Ll9zZWxlY3RzID0gW11cbiAgICBwbHVja1F1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXSA9IGpvaW5lZFBhdGhzID8gbmV3IFNldChqb2luZWRQYXRocykgOiBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgW3BsdWNrSW5kZXgsIHBsdWNrRW50cnldIG9mIHBsdWNrLmVudHJpZXMoKSkge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBwYXRoOiBwbHVja0VudHJ5LnBhdGhcbiAgICAgIH0pXG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBwbHVja0VudHJ5LmNvbHVtbixcbiAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogXCJwbHVja1wiXG4gICAgICB9KVxuXG4gICAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gcGx1Y2sgY29sdW1uIFwiJHtwbHVja0VudHJ5LmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHBsdWNrRW50cnkucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoOiBwbHVja0VudHJ5LnBhdGgsIHF1ZXJ5OiBwbHVja1F1ZXJ5fSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBwbHVja1F1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wbHVja0VudHJ5LnBhdGgpXG4gICAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtwbHVja1F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHRhYmxlUmVmZXJlbmNlKX0uJHtwbHVja1F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG4gICAgICBjb25zdCBhbGlhcyA9IGBmcm9udGVuZF9tb2RlbF9wbHVja18ke3BsdWNrSW5kZXh9YFxuXG4gICAgICBwbHVja1F1ZXJ5LnNlbGVjdChgJHtjb2x1bW5TcWx9IEFTICR7cGx1Y2tRdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oYWxpYXMpfWApXG4gICAgICBhbGlhc2VzLnB1c2goYWxpYXMpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHBsdWNrUXVlcnkucmVzdWx0cygpXG5cbiAgICBpZiAoYWxpYXNlcy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IFthbGlhc10gPSBhbGlhc2VzXG5cbiAgICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylbYWxpYXNdKVxuICAgIH1cblxuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBjb25zdCByb3dIYXNoID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgIHJldHVybiBhbGlhc2VzLm1hcCgoYWxpYXMpID0+IHJvd0hhc2hbYWxpYXNdKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBmcm9udGVuZC1tb2RlbCBwbHVjayBhdHRyaWJ1dGUgdG8gYSBkYXRhYmFzZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBSZXNvbHZlZCBEQiBjb2x1bW4gbmFtZS5cbiAgICovXG4gIHJlc29sdmVGcm9udGVuZE1vZGVsUGx1Y2tDb2x1bW5OYW1lKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVOYW1lc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lcyAmJiAhYXR0cmlidXRlTmFtZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbENvbHVtbk5hbWUobW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cG9zZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzIGZvciBhIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPiB8IG51bGx9IEV4cG9zZWQgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLCBvciBudWxsIHdoZW4gdGhlIHJlc291cmNlIGV4cG9zZXMgYWxsIERCLWJhY2tlZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuIG5ldyBTZXQoKVxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlc1xuXG4gICAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZU5hbWVzKGF0dHJpYnV0ZXMpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZXMuc2l6ZSA8IDEpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXR0cmlidXRlTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cG9zZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uW1wiYXR0cmlidXRlc1wiXX0gYXR0cmlidXRlcyAtIFJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gRXhwb3NlZCByZXNvdXJjZSBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVOYW1lcyhhdHRyaWJ1dGVzKSB7XG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0cmlidXRlQ29uZmlndXJhdGlvbn0gKi8gKGF0dHJpYnV0ZSlcblxuICAgICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5uYW1lICE9PSBcInN0cmluZ1wiIHx8IGF0dHJpYnV0ZUNvbmZpZy5uYW1lLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZC1tb2RlbCByZXNvdXJjZSBhdHRyaWJ1dGUgYXJyYXkgZW50cmllcyBtdXN0IGJlIHN0cmluZ3Mgb3IgY29uZmlncyB3aXRoIGEgbmFtZS5cIilcbiAgICAgICAgfVxuXG4gICAgICAgIGF0dHJpYnV0ZU5hbWVzLmFkZChhdHRyaWJ1dGVDb25maWcubmFtZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBmcm9udGVuZC1tb2RlbCBwbHVjayBkZWZpbml0aW9ucyBvbmx5IHJlZmVyZW5jZSBleHBvc2VkIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFBsdWNrW119IHBsdWNrIC0gUGx1Y2sgZGVzY3JpcHRvcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHBsdWNrKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcblxuICAgIGZvciAoY29uc3QgcGx1Y2tFbnRyeSBvZiBwbHVjaykge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBwYXRoOiBwbHVja0VudHJ5LnBhdGhcbiAgICAgIH0pXG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFBsdWNrQ29sdW1uTmFtZSh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHBsdWNrRW50cnkuY29sdW1uLFxuICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gcGx1Y2sgY29sdW1uIFwiJHtwbHVja0VudHJ5LmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBmcm9udGVuZC1tb2RlbCBSYW5zYWNrIGRlZmluaXRpb25zIG9ubHkgcmVmZXJlbmNlIGV4cG9zZWQgcmVzb3VyY2UgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJhbnNhY2sgLSBSYW5zYWNrIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBbGxvd2VkKHJhbnNhY2spIHtcbiAgICBjb25zdCB7cywgLi4uZmlsdGVyUGFyYW1zfSA9IHJhbnNhY2tcblxuICAgIGlmIChPYmplY3Qua2V5cyhmaWx0ZXJQYXJhbXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cEFsbG93ZWQoe1xuICAgICAgICBncm91cDogdGhpcy5mcm9udGVuZE1vZGVsUmFuc2Fja0dyb3VwKGZpbHRlclBhcmFtcylcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBzID09PSBcInN0cmluZ1wiICYmIHMudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3Qgc29ydCBvZiB0aGlzLmZyb250ZW5kTW9kZWxSYW5zYWNrU29ydHMocykpIHtcbiAgICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0F0dHJpYnV0ZUFsbG93ZWQoe1xuICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IHNvcnQuYXR0cmlidXRlLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZTogXCJyYW5zYWNrIHNvcnRcIlxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBncm91cC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGZpbHRlclBhcmFtcyAtIFJhbnNhY2sgZmlsdGVyIHBhcmFtcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrR3JvdXB9IE5vcm1hbGl6ZWQgUmFuc2FjayBncm91cC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSYW5zYWNrR3JvdXAoZmlsdGVyUGFyYW1zKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBub3JtYWxpemVSYW5zYWNrR3JvdXAodGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSwgZmlsdGVyUGFyYW1zKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBzb3J0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNvcnRTdHJpbmcgLSBSYW5zYWNrIHNvcnQgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tTb3J0W119IE5vcm1hbGl6ZWQgUmFuc2FjayBzb3J0cy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSYW5zYWNrU29ydHMoc29ydFN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gcGFyc2VSYW5zYWNrU29ydCh0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLCBzb3J0U3RyaW5nKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnRzIGEgbm9ybWFsaXplZCBmcm9udGVuZC1tb2RlbCBSYW5zYWNrIGdyb3VwIG9ubHkgcmVmZXJlbmNlcyBleHBvc2VkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzZXJ0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tHcm91cH0gYXJncy5ncm91cCAtIFJhbnNhY2sgZ3JvdXAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cEFsbG93ZWQoe2dyb3VwfSkge1xuICAgIGZvciAoY29uc3QgY29uZGl0aW9uIG9mIGdyb3VwLmNvbmRpdGlvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGNvbmRpdGlvbi5hdHRyaWJ1dGVzKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgICAgIHBhdGg6IGF0dHJpYnV0ZS5wYXRoXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0F0dHJpYnV0ZUFsbG93ZWQoe1xuICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IGF0dHJpYnV0ZS5hdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZTogXCJyYW5zYWNrXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwaW5nIG9mIGdyb3VwLmdyb3VwaW5ncykge1xuICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0dyb3VwQWxsb3dlZCh7Z3JvdXA6IGdyb3VwaW5nfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBvbmUgbm9ybWFsaXplZCBmcm9udGVuZC1tb2RlbCBSYW5zYWNrIGF0dHJpYnV0ZSBpcyBleHBvc2VkIGJ5IGl0cyByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBc3NlcnRpb24gYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm9wZXJhdGlvbk5hbWUgLSBPcGVyYXRpb24gbmFtZSBmb3IgZXJyb3JzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrQXR0cmlidXRlQWxsb3dlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgb3BlcmF0aW9uTmFtZX0pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZXMgJiYgIWF0dHJpYnV0ZU5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gJHtvcGVyYXRpb25OYW1lfSBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VhcmNoIHRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7bW9kZWxDbGFzcywgcGF0aH0pIHtcbiAgICBsZXQgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0YXJnZXRNb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBzZWFyY2ggcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICAgIH1cblxuICAgICAgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3NcbiAgICB9XG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgc2VhcmNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlYXJjaCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIGZpbHRlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgcGF0aDogc2VhcmNoLnBhdGhcbiAgICB9KVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLnJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7XG4gICAgICBhdHRyaWJ1dGVOYW1lOiBzZWFyY2guY29sdW1uLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwic2VhcmNoXCJcbiAgICB9KVxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBzZWFyY2ggY29sdW1uIFwiJHtzZWFyY2guY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChzZWFyY2gucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aDogc2VhcmNoLnBhdGgsIHF1ZXJ5fSlcbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5zZWFyY2gucGF0aClcbiAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcbiAgICBjb25zdCBvcGVyYXRvck1hcCA9IHtcbiAgICAgIGVxOiBcIj1cIixcbiAgICAgIGd0OiBcIj5cIixcbiAgICAgIGd0ZXE6IFwiPj1cIixcbiAgICAgIGxpa2U6IFwiTElLRVwiLFxuICAgICAgbHQ6IFwiPFwiLFxuICAgICAgbHRlcTogXCI8PVwiLFxuICAgICAgbm90RXE6IFwiIT1cIlxuICAgIH1cbiAgICBjb25zdCBzcWxPcGVyYXRvciA9IG9wZXJhdG9yTWFwW3NlYXJjaC5vcGVyYXRvcl1cblxuICAgIGlmIChzZWFyY2gub3BlcmF0b3IgPT09IFwiZXFcIikge1xuICAgICAgaWYgKHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsQXJyYXlTZWFyY2goe2VtcHR5U3FsOiBcIjE9MFwiLCBvcGVyYXRvclNxbDogXCJJTlwiLCBxdWVyeSwgc2VhcmNoLCBjb2x1bW5TcWx9KSkgcmV0dXJuXG5cbiAgICAgIGlmIChzZWFyY2gudmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSBJUyBOVUxMYClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNlYXJjaC5vcGVyYXRvciA9PT0gXCJub3RFcVwiKSB7XG4gICAgICBpZiAodGhpcy5hcHBseUZyb250ZW5kTW9kZWxBcnJheVNlYXJjaCh7ZW1wdHlTcWw6IFwiMT0xXCIsIG9wZXJhdG9yU3FsOiBcIk5PVCBJTlwiLCBxdWVyeSwgc2VhcmNoLCBjb2x1bW5TcWx9KSkgcmV0dXJuXG5cbiAgICAgIGlmIChzZWFyY2gudmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSBJUyBOT1QgTlVMTGApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gJHtzcWxPcGVyYXRvcn0gJHtxdWVyeS5kcml2ZXIucXVvdGUoc2VhcmNoLnZhbHVlKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGFycmF5LXZhbHVlZCBlcXVhbGl0eSBzZWFyY2ggZmlsdGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5TcWwgLSBTUUwgZm9yIHRoZSBzZWFyY2hlZCBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmVtcHR5U3FsIC0gU1FMIHByZWRpY2F0ZSB1c2VkIHdoZW4gdGhlIGFycmF5IGlzIGVtcHR5LlxuICAgKiBAcGFyYW0ge1wiSU5cIiB8IFwiTk9UIElOXCJ9IGFyZ3Mub3BlcmF0b3JTcWwgLSBTUUwgYXJyYXkgb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFNlYXJjaH0gYXJncy5zZWFyY2ggLSBTZWFyY2ggZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbiBhcnJheSBwcmVkaWNhdGUgd2FzIGFwcGxpZWQuXG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxBcnJheVNlYXJjaCh7Y29sdW1uU3FsLCBlbXB0eVNxbCwgb3BlcmF0b3JTcWwsIHF1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNlYXJjaC52YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKHNlYXJjaC52YWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgIHF1ZXJ5LndoZXJlKGVtcHR5U3FsKVxuICAgIH0gZWxzZSB7XG4gICAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9ICR7b3BlcmF0b3JTcWx9ICgke3NlYXJjaC52YWx1ZS5tYXAoKGVudHJ5KSA9PiBxdWVyeS5kcml2ZXIucXVvdGUoZW50cnkpKS5qb2luKFwiLCBcIil9KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHBhZ2luYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnaW5hdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQYWdpbmF0aW9ufSBhcmdzLnBhZ2luYXRpb24gLSBQYWdpbmF0aW9uIHZhbHVlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtxdWVyeSwgcGFnaW5hdGlvbn0pIHtcbiAgICBpZiAocGFnaW5hdGlvbi5saW1pdCAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkubGltaXQocGFnaW5hdGlvbi5saW1pdClcbiAgICB9XG5cbiAgICBpZiAocGFnaW5hdGlvbi5vZmZzZXQgIT09IG51bGwpIHtcbiAgICAgIHF1ZXJ5Lm9mZnNldChwYWdpbmF0aW9uLm9mZnNldClcbiAgICB9XG5cbiAgICBpZiAocGFnaW5hdGlvbi5wZXJQYWdlICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5wZXJQYWdlKHBhZ2luYXRpb24ucGVyUGFnZSlcbiAgICB9XG5cbiAgICBpZiAocGFnaW5hdGlvbi5wYWdlICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5wYWdlKHBhZ2luYXRpb24ucGFnZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCB3aGVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXaGVyZSBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy53aGVyZSAtIFJvb3QtbW9kZWwgd2hlcmUgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxXaGVyZSh7cXVlcnksIHdoZXJlfSkge1xuICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmVGb3JQYXRoKHtcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICBwYXRoOiBbXSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgd2hlcmVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgam9pbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbnMgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muam9pbnMgLSBSZWxhdGlvbnNoaXAtb2JqZWN0IGpvaW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KSB7XG4gICAgY29uc3Qgam9pblBhdGhLZXlzID0gbmV3IFNldCgpXG5cbiAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zRm9yUGF0aCh7XG4gICAgICBqb2lucyxcbiAgICAgIGpvaW5QYXRoS2V5cyxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICBwYXRoOiBbXSxcbiAgICAgIHF1ZXJ5XG4gICAgfSlcblxuICAgIHF1ZXJ5LmpvaW5zKGpvaW5zKVxuXG4gICAgY29uc3QgcXVlcnlNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KVxuICAgIGNvbnN0IGpvaW5lZFBhdGhzID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdIHx8IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBqb2luUGF0aEtleSBvZiBqb2luUGF0aEtleXMpIHtcbiAgICAgIGpvaW5lZFBhdGhzLmFkZChqb2luUGF0aEtleSlcbiAgICB9XG5cbiAgICBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gPSBqb2luZWRQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgam9pbnMgZm9yIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbnMgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muam9pbnMgLSBKb2lucyBmb3IgY3VycmVudCBwYXRoLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBhcmdzLmpvaW5QYXRoS2V5cyAtIEpvaW5lZCBwYXRoIGtleXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGZvciBjdXJyZW50IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zRm9yUGF0aCh7am9pbnMsIGpvaW5QYXRoS2V5cywgbW9kZWxDbGFzcywgcGF0aCwgcXVlcnl9KSB7XG4gICAgdm9pZCBxdWVyeVxuXG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwSm9pbl0gb2YgT2JqZWN0LmVudHJpZXMoam9pbnMpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBqb2luIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciBqb2luIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBvbiAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBQYXRoID0gWy4uLnBhdGgsIHJlbGF0aW9uc2hpcE5hbWVdXG4gICAgICBqb2luUGF0aEtleXMuYWRkKHJlbGF0aW9uc2hpcFBhdGguam9pbihcIi5cIikpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBKb2luID09PSB0cnVlKSBjb250aW51ZVxuXG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zRm9yUGF0aCh7XG4gICAgICAgIGpvaW5zOiByZWxhdGlvbnNoaXBKb2luLFxuICAgICAgICBqb2luUGF0aEtleXMsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgIHBhdGg6IHJlbGF0aW9uc2hpcFBhdGgsXG4gICAgICAgIHF1ZXJ5XG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV4cG9zZWQgYXR0cmlidXRlIG5hbWVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz4gfCBudWxsfSAtIEV4cG9zZWQgYXR0cmlidXRlIG5hbWVzLCBvciBudWxsIHdoZW4gbm8gcmVzb3VyY2UgbWV0YWRhdGEgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEV4cG9zZWRBdHRyaWJ1dGVOYW1lc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlPy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlc1xuXG4gICAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gYXR0cmlidXRlc1xuICAgICAgICAubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHJldHVybiBlbnRyeVxuICAgICAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbFxuXG4gICAgICAgICAgY29uc3QgbmFtZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpLm5hbWVcblxuICAgICAgICAgIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLmxlbmd0aCA+IDAgPyBuYW1lIDogbnVsbFxuICAgICAgICB9KVxuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gdHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gbmV3IFNldChhdHRyaWJ1dGVOYW1lcylcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBmcm9udGVuZC1zdXBwbGllZCBrZXkgdG8gaXRzIGNhbm9uaWNhbCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gRnJvbnRlbmQga2V5IG9yIHJhdyBjb2x1bW4ga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDYW5vbmljYWwgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZUZvcktleShtb2RlbENsYXNzLCBrZXkpIHtcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGtleSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiByZXNvbHZlZEF0dHJpYnV0ZU5hbWVcblxuICAgIGNvbnN0IGNvbHVtbkF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtrZXldXG5cbiAgICByZXR1cm4gY29sdW1uQXR0cmlidXRlTmFtZSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZnJvbnRlbmQtc3VwcGxpZWQgYXR0cmlidXRlIGlzIGV4cG9zZWQgYnkgdGhlIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBSZXF1ZXN0ZWQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBwZXJtaXRzIHRoZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQXR0cmlidXRlSXNFeHBvc2VkKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGV4cG9zZWRBdHRyaWJ1dGVOYW1lcyA9IHRoaXMuZnJvbnRlbmRNb2RlbEV4cG9zZWRBdHRyaWJ1dGVOYW1lc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmICghZXhwb3NlZEF0dHJpYnV0ZU5hbWVzKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGV4cG9zZWRBdHRyaWJ1dGVOYW1lcy5oYXMoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnRzIGEgc2VsZWN0ZWQgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlIGxpc3Qgb25seSByZWZlcmVuY2VzIGV4cG9zZWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmF0dHJpYnV0ZU5hbWVzIC0gU2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtcInNlbGVjdFwiIHwgXCJzZWxlY3RzRXh0cmFcIn0gYXJncy5vcGVyYXRpb25OYW1lIC0gU2VsZWN0aW9uIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIEFsbG93ZWQgc2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0FsbG93ZWQoe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzLCBvcGVyYXRpb25OYW1lfSkge1xuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhdHRyaWJ1dGVOYW1lcykge1xuICAgICAgaWYgKHRoaXMuZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUlzRXhwb3NlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pKSBjb250aW51ZVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biAke29wZXJhdGlvbk5hbWV9IGF0dHJpYnV0ZSBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHVzZXItcXVlcnlhYmxlIGZyb250ZW5kIGF0dHJpYnV0ZSB0byBhIGRhdGFiYXNlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gUmVxdWVzdGVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtcImdyb3VwXCIgfCBcInBsdWNrXCIgfCBcInNlYXJjaFwiIHwgXCJzb3J0XCIgfCBcIndoZXJlXCJ9IGFyZ3Mub3BlcmF0aW9uTmFtZSAtIFF1ZXJ5IG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXNvbHZlZCBjb2x1bW4gbmFtZS5cbiAgICovXG4gIHJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgb3BlcmF0aW9uTmFtZX0pIHtcbiAgICB2b2lkIG9wZXJhdGlvbk5hbWVcblxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMuZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVGb3JLZXkobW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUgJiYgIXRoaXMuZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUlzRXhwb3NlZCh7YXR0cmlidXRlTmFtZTogcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbENvbHVtbk5hbWUobW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGtleSB0aGF0IG1heSBiZSBlaXRoZXIgYSBjYW1lbENhc2UgYXR0cmlidXRlIG5hbWUgb3IgYSByYXcgREJcbiAgICogY29sdW1uIG5hbWUgdG8gaXRzIGNhbm9uaWNhbCBjb2x1bW4gbmFtZS4gIFJldHVybnMgYHVuZGVmaW5lZGAgd2hlbiB0aGVcbiAgICoga2V5IG1hdGNoZXMgbmVpdGhlciBtYXAuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEF0dHJpYnV0ZSBuYW1lIG9yIGNvbHVtbiBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVzb2x2ZWQgREIgY29sdW1uIG5hbWUsIG9yIGB1bmRlZmluZWRgLlxuICAgKi9cbiAgcmVzb2x2ZUZyb250ZW5kTW9kZWxDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGtleSkge1xuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoa2V5KVxuXG4gICAgaWYgKHJlc29sdmVkQXR0cmlidXRlTmFtZSkgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkQXR0cmlidXRlTmFtZV1cblxuICAgIC8vIEZhbGwgYmFjazogdGhlIGtleSBtYXkgYWxyZWFkeSBiZSBhIHJhdyBEQiBjb2x1bW4gbmFtZSBub3QgcHJlc2VudCBpbiB0aGUgYXR0cmlidXRlIG1hcC5cbiAgICBpZiAobW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClba2V5XSkgcmV0dXJuIGtleVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgd2hlcmUgZm9yIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2hlcmUgYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgZm9yIGN1cnJlbnQgd2hlcmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mud2hlcmUgLSBXaGVyZSBjb25kaXRpb25zIGZvciBjdXJyZW50IHNjb3BlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlRm9yUGF0aCh7bW9kZWxDbGFzcywgcGF0aCwgcXVlcnksIHdoZXJlfSkge1xuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLnJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IFwid2hlcmVcIlxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbHVtbk5hbWUpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGgsIHF1ZXJ5fSlcblxuICAgICAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wYXRoKVxuICAgICAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICBpZiAodmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkVmFsdWVzID0gdmFsdWUubWFwKChlbnRyeSkgPT4gdGhpcy5ub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmVDb2x1bW5WYWx1ZSh7Y29sdW1uTmFtZSwgbW9kZWxDbGFzcywgdmFsdWU6IGVudHJ5fSkpXG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkVmFsdWVzLmluY2x1ZGVzKGZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hTeW1ib2wpKSB7XG4gICAgICAgICAgICAgIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9IElOICgke25vcm1hbGl6ZWRWYWx1ZXMubWFwKChlbnRyeSkgPT4gcXVlcnkuZHJpdmVyLnF1b3RlKGVudHJ5KSkuam9pbihcIiwgXCIpfSlgKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gSVMgTlVMTGApXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5ub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmVDb2x1bW5WYWx1ZSh7Y29sdW1uTmFtZSwgbW9kZWxDbGFzcywgdmFsdWV9KVxuXG4gICAgICAgICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSA9PT0gZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbCkge1xuICAgICAgICAgICAgcXVlcnkud2hlcmUoXCIxPTBcIilcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSA9ICR7cXVlcnkuZHJpdmVyLnF1b3RlKG5vcm1hbGl6ZWRWYWx1ZSl9YClcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbYXR0cmlidXRlTmFtZV1cblxuICAgICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHdoZXJlIHJlbGF0aW9uc2hpcCBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgZm9yIHdoZXJlIHJlbGF0aW9uc2hpcCBcIiR7YXR0cmlidXRlTmFtZX1cIiBvbiAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwUGF0aCA9IFsuLi5wYXRoLCBhdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmVGb3JQYXRoKHtcbiAgICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICAgIHBhdGg6IHJlbGF0aW9uc2hpcFBhdGgsXG4gICAgICAgICAgcXVlcnksXG4gICAgICAgICAgd2hlcmU6IHZhbHVlXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gd2hlcmUgY29sdW1uIFwiJHthdHRyaWJ1dGVOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCB3aGVyZSBjb2x1bW4gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFdoZXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBzeW1ib2x9IC0gU1FMLXNhZmUgd2hlcmUgdmFsdWUuXG4gICAqL1xuICBub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmVDb2x1bW5WYWx1ZSh7Y29sdW1uTmFtZSwgbW9kZWxDbGFzcywgdmFsdWV9KSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKT8udG9Mb3dlckNhc2UoKVxuICAgICAgY29uc3QgaXNEYXRlVGltZUNvbHVtbiA9IHR5cGVvZiBjb2x1bW5UeXBlID09PSBcInN0cmluZ1wiICYmIFtcImRhdGVcIiwgXCJkYXRldGltZVwiLCBcInRpbWVzdGFtcFwiXS5zb21lKCh0eXBlKSA9PiBjb2x1bW5UeXBlLmluY2x1ZGVzKHR5cGUpKVxuXG4gICAgICBpZiAoaXNEYXRlVGltZUNvbHVtbikge1xuICAgICAgICBjb25zdCBwYXJzZWREYXRlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKX0pXG5cbiAgICAgICAgaWYgKGlzRGF0ZShwYXJzZWREYXRlKSkge1xuICAgICAgICAgIHJldHVybiBwYXJzZWREYXRlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBjb2x1bW5UeXBlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpXG4gICAgICBjb25zdCBvYmplY3RWYWx1ZVR5cGVzID0gbmV3IFNldChbXCJjaGFyXCIsIFwidmFyY2hhclwiLCBcIm52YXJjaGFyXCIsIFwic3RyaW5nXCIsIFwiZW51bVwiLCBcImpzb25cIiwgXCJqc29uYlwiLCBcImNpdGV4dFwiLCBcImJpbmFyeVwiLCBcInZhcmJpbmFyeVwiXSlcbiAgICAgIGNvbnN0IHN1cHBvcnRzT2JqZWN0VmFsdWVzID0gbm9ybWFsaXplZFR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8IG9iamVjdFZhbHVlVHlwZXMuaGFzKG5vcm1hbGl6ZWRUeXBlKVxuXG4gICAgICBpZiAoIXN1cHBvcnRzT2JqZWN0VmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIGdyb3VwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEdyb3VwIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEdyb3VwfSBhcmdzLmdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxHcm91cCh7cXVlcnksIGdyb3VwfSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIHBhdGg6IGdyb3VwLnBhdGhcbiAgICB9KVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLnJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7XG4gICAgICBhdHRyaWJ1dGVOYW1lOiBncm91cC5jb2x1bW4sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJncm91cFwiXG4gICAgfSlcblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gZ3JvdXAgY29sdW1uIFwiJHtncm91cC5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGg6IGdyb3VwLnBhdGgsIHF1ZXJ5fSlcblxuICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLmdyb3VwLnBhdGgpXG4gICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxHcm91cENvbHVtbih7Y29sdW1uU3FsLCBxdWVyeX0pXG4gIH1cblxuICAvKipcbiAgICogQWRkcyByb290LW1vZGVsIGNvbHVtbnMgdG8gR1JPVVAgQlkgc28gc3RyaWN0IFNRTCBlbmdpbmVzIGFjY2VwdCBkZWZhdWx0IHJvb3QtdGFibGUgc2VsZWN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFJvb3RHcm91cENvbHVtbnMoe3F1ZXJ5fSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3Qgcm9vdFRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKClcblxuICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBPYmplY3QudmFsdWVzKGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXApKSB7XG4gICAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZShyb290VGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEdyb3VwQ29sdW1uKHtjb2x1bW5TcWwsIHF1ZXJ5fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIGdyb3VwLWJ5IFNRTCBjb2x1bW4gaXMgb25seSBhcHBlbmRlZCBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtblNxbCAtIEZ1bGx5LXF1YWxpZmllZCBjb2x1bW4gU1FMLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVuc3VyZUZyb250ZW5kTW9kZWxHcm91cENvbHVtbih7Y29sdW1uU3FsLCBxdWVyeX0pIHtcbiAgICBjb25zdCBxdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpXG4gICAgY29uc3QgZ3JvdXBlZENvbHVtbnMgPSBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxHcm91cGVkQ29sdW1uc1N5bWJvbF0gfHwgbmV3IFNldCgpXG5cbiAgICBpZiAoZ3JvdXBlZENvbHVtbnMuaGFzKGNvbHVtblNxbCkpIHJldHVyblxuXG4gICAgcXVlcnkuZ3JvdXAoY29sdW1uU3FsKVxuICAgIGdyb3VwZWRDb2x1bW5zLmFkZChjb2x1bW5TcWwpXG4gICAgcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsR3JvdXBlZENvbHVtbnNTeW1ib2xdID0gZ3JvdXBlZENvbHVtbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHRyYW5zbGF0ZWQgYXR0cmlidXRlIHByZWxvYWRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBRdWVyeSB3aXRoIHRyYW5zbGF0aW9ucyBwcmVsb2FkZWQgaWYgbmVlZGVkLlxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsVHJhbnNsYXRlZEF0dHJpYnV0ZVByZWxvYWRzKHtxdWVyeX0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbEVmZmVjdGl2ZVNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcywgdGhpcy5mcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHx8IFtdKVxuICAgICAgfHwgdGhpcy5mcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIXNlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHF1ZXJ5XG5cbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gKi8gKHJlc291cmNlLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KHJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXSlcbiAgICBsZXQgbmVlZHNUcmFuc2xhdGlvbnMgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgY29uc3QgaG9va05hbWUgPSBgJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZVNlbGVjdGVkYFxuICAgICAgY29uc3QgZHluYW1pY1Jlc291cmNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVzb3VyY2UpKVxuXG4gICAgICBpZiAodHlwZW9mIGR5bmFtaWNSZXNvdXJjZVtob29rTmFtZV0gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBkeW5hbWljUmVzb3VyY2VbaG9va05hbWVdKHtxdWVyeX0pXG5cbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIHF1ZXJ5ID0gcmVzdWx0XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgbmVlZHNUcmFuc2xhdGlvbnMgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG5lZWRzVHJhbnNsYXRpb25zKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQoe3RyYW5zbGF0aW9uczoge319KVxuICAgIH1cblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgc29ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFNvcnR9IGFyZ3Muc29ydCAtIFNvcnQgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxTb3J0KHtxdWVyeSwgc29ydH0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBwYXRoOiBzb3J0LnBhdGhcbiAgICB9KVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVzTWFwID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbnNNYXAoKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVOYW1lcyA9IE9iamVjdC5rZXlzKHRyYW5zbGF0ZWRBdHRyaWJ1dGVzTWFwKVxuICAgIGNvbnN0IGlzVHJhbnNsYXRlZFNvcnRBdHRyaWJ1dGUgPSB0cmFuc2xhdGVkQXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoc29ydC5jb2x1bW4pXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgYXR0cmlidXRlTmFtZTogc29ydC5jb2x1bW4sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJzb3J0XCJcbiAgICB9KVxuICAgIGNvbnN0IGRpcmVjdGlvbiA9IHNvcnQuZGlyZWN0aW9uLnRvVXBwZXJDYXNlKClcblxuICAgIGlmIChpc1RyYW5zbGF0ZWRTb3J0QXR0cmlidXRlKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGlvbk1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgICAgY29uc3QgdHJhbnNsYXRpb25BdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwID0gdHJhbnNsYXRpb25Nb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgICAgY29uc3QgdHJhbnNsYXRpb25Db2x1bW5OYW1lID0gdHJhbnNsYXRpb25BdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwW3NvcnQuY29sdW1uXVxuICAgICAgY29uc3QgdHJhbnNsYXRpb25QYXRoID0gc29ydC5wYXRoLmNvbmNhdChbXCJjdXJyZW50VHJhbnNsYXRpb25cIl0pXG5cbiAgICAgIGlmICghdHJhbnNsYXRpb25Db2x1bW5OYW1lKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHRyYW5zbGF0ZWQgc29ydCBjb2x1bW4gXCIke3NvcnQuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxTb3J0Sm9pblBhdGgoe3BhdGg6IHRyYW5zbGF0aW9uUGF0aCwgcXVlcnl9KVxuXG4gICAgICBjb25zdCB0cmFuc2xhdGlvblRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnRyYW5zbGF0aW9uUGF0aClcbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQ29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodHJhbnNsYXRpb25UYWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKHRyYW5zbGF0aW9uQ29sdW1uTmFtZSl9YFxuXG4gICAgICBxdWVyeS5vcmRlcihgJHt0cmFuc2xhdGlvbkNvbHVtblNxbH0gJHtkaXJlY3Rpb259YClcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBzb3J0IGNvbHVtbiBcIiR7c29ydC5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsU29ydEpvaW5QYXRoKHtwYXRoOiBzb3J0LnBhdGgsIHF1ZXJ5fSlcblxuICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnNvcnQucGF0aClcbiAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcblxuICAgIHF1ZXJ5Lm9yZGVyKGAke2NvbHVtblNxbH0gJHtkaXJlY3Rpb259YClcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGEgc29ydCBqb2luIHBhdGggaGFzIGJlZW4gam9pbmVkIG9uIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW4gYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnN1cmVGcm9udGVuZE1vZGVsU29ydEpvaW5QYXRoKHtwYXRoLCBxdWVyeX0pIHtcbiAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aCwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYSByZWxhdGlvbnNoaXAgcGF0aCBoYXMgZXhhY3RseSBvbmUgU1FMIGpvaW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbiBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnBhdGggLSBSZWxhdGlvbnNoaXAgam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aCwgcXVlcnl9KSB7XG4gICAgaWYgKHBhdGgubGVuZ3RoIDwgMSkgcmV0dXJuXG5cbiAgICBjb25zdCBxdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpXG4gICAgY29uc3Qgam9pbmVkUGF0aHMgPSBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gfHwgbmV3IFNldCgpXG4gICAgY29uc3QgcGF0aEtleSA9IHBhdGguam9pbihcIi5cIilcblxuICAgIGlmIChqb2luZWRQYXRocy5oYXMocGF0aEtleSkpIHJldHVyblxuXG4gICAgcXVlcnkuam9pbnMoYnVpbGRGcm9udGVuZE1vZGVsSm9pbk9iamVjdEZyb21QYXRoKHBhdGgpKVxuICAgIGpvaW5lZFBhdGhzLmFkZChwYXRoS2V5KVxuICAgIHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXSA9IGpvaW5lZFBhdGhzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3RlZCBhdHRyaWJ1dGVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIFNlbGVjdGVkIGF0dHJpYnV0ZXMgZm9yIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IHNlbGVjdCA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdCgpXG5cbiAgICBpZiAoIXNlbGVjdCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdFttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSB8fCBudWxsXG5cbiAgICBpZiAoIXNlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNBbGxvd2VkKHtcbiAgICAgIGF0dHJpYnV0ZU5hbWVzOiBzZWxlY3RlZEF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJzZWxlY3RcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3RzIGV4dHJhIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIEV4dHJhIGF0dHJpYnV0ZXMgKGxvYWRlZCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdHMpIGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3Qgc2VsZWN0c0V4dHJhID0gdGhpcy5mcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhKClcblxuICAgIGlmICghc2VsZWN0c0V4dHJhKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZXh0cmFBdHRyaWJ1dGVzID0gc2VsZWN0c0V4dHJhW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldIHx8IG51bGxcblxuICAgIGlmICghZXh0cmFBdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0FsbG93ZWQoe1xuICAgICAgYXR0cmlidXRlTmFtZXM6IGV4dHJhQXR0cmlidXRlcyxcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBvcGVyYXRpb25OYW1lOiBcInNlbGVjdHNFeHRyYVwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZmluYWwgc2V0IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBzZXJpYWxpemUgZm9yIGEgbW9kZWwgY2xhc3M6XG4gICAqIGFuIGV4cGxpY2l0IG5hcnJvd2luZyBgc2VsZWN0YCB3aW5zOyBvdGhlcndpc2UsIHdoZW4gYHNlbGVjdHNFeHRyYWAgaXMgZ2l2ZW4sXG4gICAqIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZXMgcGx1cyB0aGUgZXh0cmFzOyBvdGhlcndpc2UgbnVsbCAoZGVmYXVsdCBiZWhhdmlvcikuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZmFsbGJhY2tBdHRyaWJ1dGVOYW1lcyAtIEF0dHJpYnV0ZSBuYW1lcyB0byB0cmVhdCBhcyB0aGUgZGVmYXVsdHMgd2hlbiB0aGUgcmVzb3VyY2UgZGVjbGFyZXMgbm9uZS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBFZmZlY3RpdmUgc2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzLCBvciBudWxsIGZvciBkZWZhdWx0IHNlcmlhbGl6YXRpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRWZmZWN0aXZlU2VsZWN0ZWRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBmYWxsYmFja0F0dHJpYnV0ZU5hbWVzKSB7XG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VsZWN0ZWRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKHNlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHNlbGVjdGVkQXR0cmlidXRlc1xuXG4gICAgY29uc3QgZXh0cmFBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFleHRyYUF0dHJpYnV0ZXMpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkZWZhdWx0QXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbERlZmF1bHRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB8fCBmYWxsYmFja0F0dHJpYnV0ZU5hbWVzXG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXcgU2V0KFsuLi5kZWZhdWx0QXR0cmlidXRlcywgLi4uZXh0cmFBdHRyaWJ1dGVzXSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBkZWZhdWx0IGF0dHJpYnV0ZXMgZm9yIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IC0gRGVmYXVsdCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzIGRlY2xhcmVkIG9uIHRoZSByZXNvdXJjZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxEZWZhdWx0QXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlPy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlc1xuXG4gICAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRydWVcblxuICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpXG5cbiAgICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy5zZWxlY3RlZEJ5RGVmYXVsdCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfSlcbiAgICAgICAgLm1hcCgoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiA/IGVudHJ5IDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChlbnRyeSkubmFtZSlcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKVxuICAgICAgICAuZmlsdGVyKChbLCBjb25maWddKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWcgfHwgdHlwZW9mIGNvbmZpZyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHRydWVcblxuICAgICAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNvbmZpZykuc2VsZWN0ZWRCeURlZmF1bHQgIT09IGZhbHNlXG4gICAgICAgIH0pXG4gICAgICAgIC5tYXAoKFtuYW1lXSkgPT4gbmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIGF0dHJpYnV0ZXMgZmlsdGVyZWQgYnkgc2VsZWN0IG1hcC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBtb2RlbEF0dHJpYnV0ZXMgPSBtb2RlbC5hdHRyaWJ1dGVzKClcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxFZmZlY3RpdmVTZWxlY3RlZEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIE9iamVjdC5rZXlzKG1vZGVsQXR0cmlidXRlcykpXG4gICAgY29uc3QgZGVmYXVsdEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxEZWZhdWx0QXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgICBjb25zdCByZXNvdXJjZUluc3RhbmNlID0gdGhpcy5fc2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VGb3JNb2RlbChtb2RlbClcblxuICAgIC8qKlxuICAgICAqIFJlc291cmNlIGF0dHJpYnV0ZSBtZXRob2QgbmFtZS5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb3VyY2UgYXR0cmlidXRlIG1ldGhvZCBuYW1lLlxuICAgICAqL1xuICAgIGNvbnN0IHJlc291cmNlQXR0cmlidXRlTWV0aG9kTmFtZSA9IChhdHRyaWJ1dGVOYW1lKSA9PiBgJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZWBcblxuICAgIC8qKlxuICAgICAqIFJlc291cmNlIGhhcyBhdHRyaWJ1dGUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlW1wicmVzb3VyY2VNZXRob2RcIl0+fSAtIFJlc291cmNlIGF0dHJpYnV0ZSBtZXRob2QgZGV0YWlscy5cbiAgICAgKi9cbiAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZU1ldGhvZCA9IChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCBtZXRob2ROYW1lID0gcmVzb3VyY2VBdHRyaWJ1dGVNZXRob2ROYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIHJldHVybiByZXNvdXJjZUluc3RhbmNlPy5yZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lKSB8fCBudWxsXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJvdG90eXBlIGF0dHJpYnV0ZSBtZXRob2QuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7e21ldGhvZDogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG93bmVyTmFtZTogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBQcm90b3R5cGUgbWV0aG9kIGRldGFpbHMgd2hlbiBwcmVzZW50LlxuICAgICAqL1xuICAgIGNvbnN0IHByb3RvdHlwZUF0dHJpYnV0ZU1ldGhvZCA9IChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBsZXQgY3VycmVudFByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihtb2RlbClcblxuICAgICAgd2hpbGUgKGN1cnJlbnRQcm90b3R5cGUgJiYgY3VycmVudFByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKGN1cnJlbnRQcm90b3R5cGUsIGF0dHJpYnV0ZU5hbWUpPy52YWx1ZVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbWV0aG9kOiBjYW5kaWRhdGUsXG4gICAgICAgICAgICBvd25lck5hbWU6IGN1cnJlbnRQcm90b3R5cGUuY29uc3RydWN0b3I/Lm5hbWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjdXJyZW50UHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRQcm90b3R5cGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2VyaWFsaXplZCBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VyaWFsaXplZCBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICovXG4gICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZVZhbHVlID0gYXN5bmMgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIC8vIENoZWNrIHJlc291cmNlIGluc3RhbmNlIGZpcnN0ICh2aXJ0dWFsL2NvbXB1dGVkIGF0dHJpYnV0ZXMgdmlhICR7bmFtZX1BdHRyaWJ1dGUgY29udmVudGlvbilcbiAgICAgIGNvbnN0IHJlc291cmNlQXR0cmlidXRlID0gcmVzb3VyY2VBdHRyaWJ1dGVNZXRob2QoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHJlc291cmNlQXR0cmlidXRlKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCByZXNvdXJjZUF0dHJpYnV0ZS5tZXRob2QuY2FsbChyZXNvdXJjZUF0dHJpYnV0ZS5yZXNvdXJjZSwgbW9kZWwpXG4gICAgICB9XG5cbiAgICAgIC8vIEZhbGwgYmFjayB0byBtb2RlbCBtZXRob2RcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZExvb2t1cCA9IHByb3RvdHlwZUF0dHJpYnV0ZU1ldGhvZChhdHRyaWJ1dGVOYW1lKVxuICAgICAgY29uc3QgYXR0cmlidXRlTWV0aG9kID0gYXR0cmlidXRlTWV0aG9kTG9va3VwPy5tZXRob2RcblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gYXdhaXQgYXR0cmlidXRlTWV0aG9kLmNhbGwobW9kZWwpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBtb2RlbEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBdHRyaWJ1dGUgZXhpc3RzLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGV4aXN0cy5cbiAgICAgKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVFeGlzdHMgPSAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgcmV0dXJuIChhdHRyaWJ1dGVOYW1lIGluIG1vZGVsQXR0cmlidXRlcykgfHwgKGF0dHJpYnV0ZU5hbWUgaW4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtb2RlbCkpIHx8IEJvb2xlYW4ocmVzb3VyY2VBdHRyaWJ1dGVNZXRob2QoYXR0cmlidXRlTmFtZSkpXG4gICAgfVxuXG4gICAgaWYgKCFzZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGlmICghZGVmYXVsdEF0dHJpYnV0ZXMgfHwgZGVmYXVsdEF0dHJpYnV0ZXMubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXR1cm4gbW9kZWxBdHRyaWJ1dGVzXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2VyaWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVzID0ge31cblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGRlZmF1bHRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmICghYXR0cmlidXRlRXhpc3RzKGF0dHJpYnV0ZU5hbWUpKSBjb250aW51ZVxuICAgICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gc2VyaWFsaXplZEF0dHJpYnV0ZXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBzZXJpYWxpemVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2Ygc2VsZWN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIWF0dHJpYnV0ZUV4aXN0cyhhdHRyaWJ1dGVOYW1lKSkgY29udGludWVcbiAgICAgIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgc2VyaWFsaXplZEF0dHJpYnV0ZVZhbHVlKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcmVxdWVzdC1zY29wZWQgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZSBjYWNoZS5cbiAgICogQHJldHVybnMge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPGJvb2xlYW4sIGltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pj59IC0gQ2FjaGUuXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMpIHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSBuZXcgTWFwKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc1xuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIHVwIGEgY2FjaGVkIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBpc1JlbGF0ZWQgLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBpcyBmb3IgYSByZWxhdGVkIChub24tcm9vdCkgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDYWNoZWQgcmVzb3VyY2Ugb3IgdW5kZWZpbmVkLlxuICAgKi9cbiAgX2NhY2hlZFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlKG1vZGVsQ2xhc3MsIGlzUmVsYXRlZCkge1xuICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzTWFwKCkuZ2V0KG1vZGVsQ2xhc3MpPy5nZXQoaXNSZWxhdGVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyBhIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UgaW4gdGhlIHJlcXVlc3Qtc2NvcGVkIGNhY2hlLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNSZWxhdGVkIC0gV2hldGhlciB0aGUgcmVzb3VyY2UgaXMgZm9yIGEgcmVsYXRlZCAobm9uLXJvb3QpIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSByZXNvdXJjZSAtIFJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBpc1JlbGF0ZWQsIHJlc291cmNlKSB7XG4gICAgY29uc3QgYnlDbGFzcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNNYXAoKVxuICAgIGxldCBieVJlbGF0ZWQgPSBieUNsYXNzLmdldChtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFieVJlbGF0ZWQpIHtcbiAgICAgIGJ5UmVsYXRlZCA9IG5ldyBNYXAoKVxuICAgICAgYnlDbGFzcy5zZXQobW9kZWxDbGFzcywgYnlSZWxhdGVkKVxuICAgIH1cblxuICAgIGJ5UmVsYXRlZC5zZXQoaXNSZWxhdGVkLCByZXNvdXJjZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgcGVyLWluc3RhbmNlIGhvb2sgaW52b2tlZCBmb3IgZXZlcnkgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZVxuICAgKiByZXNvbHV0aW9uLiBUaGUgaG9vayBpcyBzY29wZWQgdG8gdGhpcyBjb250cm9sbGVyOyBpdCBuZXZlciBhZmZlY3RzIG90aGVyXG4gICAqIGNvbnRyb2xsZXIgaW5zdGFuY2VzLiBQYXNzaW5nIGBudWxsYCBjbGVhcnMgdGhlIGhvb2suXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayB8IG51bGx9IGhvb2sgLSBIb29rIGNhbGxiYWNrIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENsZWFudXAgZnVuY3Rpb24gdGhhdCByZXN0b3JlcyB0aGUgcHJldmlvdXMgaG9vay5cbiAgICovXG4gIHNldFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayhob29rKSB7XG4gICAgY29uc3QgcHJldmlvdXNIb29rID0gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9va1xuXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayA9IGhvb2tcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rID0gcHJldmlvdXNIb29rXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZSBmb3IgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBSZXNvdXJjZSBpbnN0YW5jZSBvciBudWxsLlxuICAgKi9cbiAgX3NlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlRm9yTW9kZWwobW9kZWwpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGlzUmVsYXRlZCA9IG1vZGVsQ2xhc3MgIT09IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBjYWNoZWRSZXNvdXJjZSA9IHRoaXMuX2NhY2hlZFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlKG1vZGVsQ2xhc3MsIGlzUmVsYXRlZClcblxuICAgIGlmIChjYWNoZWRSZXNvdXJjZSkge1xuICAgICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2spIHtcbiAgICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayhtb2RlbCwgY2FjaGVkUmVzb3VyY2UpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjYWNoZWRSZXNvdXJjZVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIGxldCByZXNvdXJjZVxuXG4gICAgaWYgKCFpc1JlbGF0ZWQpIHtcbiAgICAgIHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICAgIHRoaXMuX3NldENhY2hlZFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlKG1vZGVsQ2xhc3MsIGZhbHNlLCByZXNvdXJjZSlcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICBjb25zdCBtb2RlbENsYXNzTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgcmVzb3VyY2UgPSBudWxsXG5cbiAgICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcbiAgICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsQ2xhc3NOYW1lXVxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gcmVzb3VyY2VEZWZpbml0aW9uID8gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pIDogbnVsbFxuXG4gICAgICAgIGlmIChyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgcmVzb3VyY2UgPSBuZXcgcmVzb3VyY2VDbGFzcyh7XG4gICAgICAgICAgICBhYmlsaXR5OiB0aGlzLmN1cnJlbnRBYmlsaXR5KCksXG4gICAgICAgICAgICAvLyBQcm9wYWdhdGUgdGhlIGNvbnRyb2xsZXIgc28gYSByZWxhdGVkL3ByZWxvYWRlZCBtb2RlbCdzIHNlcmlhbGl6YXRpb25cbiAgICAgICAgICAgIC8vIHJlc291cmNlIGNhbiB1c2UgcmVxdWVzdCBjb250ZXh0IChlLmcuIGByZXF1ZXN0QmFzZVVybCgpYCBmb3Igc2lnbmVkXG4gICAgICAgICAgICAvLyBkb3dubG9hZCBVUkxzKS4gV2l0aG91dCBpdCwgYW55IGA8YXR0cj5BdHRyaWJ1dGVgIG1ldGhvZCB0aGF0IHJlYWNoZXNcbiAgICAgICAgICAgIC8vIGZvciB0aGUgY29udHJvbGxlciB0aHJvd3MgXCJyZXF1aXJlcyBhIGNvbnRyb2xsZXIgaW5zdGFuY2UuXCIgd2hlbiBhXG4gICAgICAgICAgICAvLyByZWxhdGlvbnNoaXAgaXMgc2VyaWFsaXplZCBhcyBhIHByZWxvYWQuXG4gICAgICAgICAgICBjb250cm9sbGVyOiB0aGlzLFxuICAgICAgICAgICAgY29udGV4dDogdGhpcy5jdXJyZW50QWJpbGl0eSgpPy5nZXRDb250ZXh0KCkgfHwge30sXG4gICAgICAgICAgICBsb2NhbHM6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICAgICAgbW9kZWxOYW1lOiBtb2RlbENsYXNzTmFtZSxcbiAgICAgICAgICAgIHBhcmFtczoge30sXG4gICAgICAgICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHJlc291cmNlQ2xhc3MucmVzb3VyY2VDb25maWcoKVxuICAgICAgICAgIH0pXG5cbiAgICAgICAgICB0aGlzLl9zZXRDYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCB0cnVlLCByZXNvdXJjZSlcblxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vaykge1xuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayhtb2RlbCwgcmVzb3VyY2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc291cmNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBmaWx0ZXIgc2VyaWFsaXphYmxlIHJlbGF0ZWQgbW9kZWxzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3MubW9kZWxzIC0gRnJvbnRlbmQgbW9kZWwgcmVjb3Jkcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLnJlbGF0aW9uc2hpcElzQ29sbGVjdGlvbiAtIFdoZXRoZXIgcmVsYXRpb24gaXMgaGFzLW1hbnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gU2VyaWFsaXphYmxlIHJlbGF0ZWQgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEZpbHRlclNlcmlhbGl6YWJsZVJlbGF0ZWRNb2RlbHMoe21vZGVscywgcmVsYXRpb25zaGlwSXNDb2xsZWN0aW9ufSkge1xuICAgIGlmICghdGhpcy5jdXJyZW50QWJpbGl0eSgpKSByZXR1cm4gbW9kZWxzXG4gICAgaWYgKG1vZGVscy5sZW5ndGggPT09IDApIHJldHVybiBtb2RlbHNcblxuICAgIC8qKlxuICAgICAqIE1vZGVscyBieSBjbGFzcy5cbiAgICAgKiBAdHlwZSB7TWFwPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAqL1xuICAgIGNvbnN0IG1vZGVsc0J5Q2xhc3MgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICBjb25zdCByZWxhdGVkTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICAgIGNvbnN0IGV4aXN0aW5nTW9kZWxzRm9yQ2xhc3MgPSBtb2RlbHNCeUNsYXNzLmdldChyZWxhdGVkTW9kZWxDbGFzcykgfHwgW11cblxuICAgICAgZXhpc3RpbmdNb2RlbHNGb3JDbGFzcy5wdXNoKG1vZGVsKVxuICAgICAgbW9kZWxzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIGV4aXN0aW5nTW9kZWxzRm9yQ2xhc3MpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXV0aG9yaXplZCBpZHMgYnkgY2xhc3MuXG4gICAgICogQHR5cGUge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgU2V0PHN0cmluZz4+fSAqL1xuICAgIGNvbnN0IGF1dGhvcml6ZWRJZHNCeUNsYXNzID0gbmV3IE1hcCgpXG4gICAgLyoqXG4gICAgICogUHJpbWFyeSBrZXlzIGJ5IGNsYXNzLlxuICAgICAqIEB0eXBlIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIGltcG9ydChcIi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbj59ICovXG4gICAgY29uc3QgcHJpbWFyeUtleXNCeUNsYXNzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IFtyZWxhdGVkTW9kZWxDbGFzcywgcmVsYXRlZE1vZGVsc10gb2YgbW9kZWxzQnlDbGFzcy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IHJlbGF0ZWRSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3MocmVsYXRlZE1vZGVsQ2xhc3MpXG5cbiAgICAgIGlmICghcmVsYXRlZFJlc291cmNlKSB7XG4gICAgICAgIGF1dGhvcml6ZWRJZHNCeUNsYXNzLnNldChyZWxhdGVkTW9kZWxDbGFzcywgbmV3IFNldCgpKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gcmVsYXRpb25zaGlwSXNDb2xsZWN0aW9uXG4gICAgICAgID8gcmVsYXRlZFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXM/LmluZGV4XG4gICAgICAgIDogcmVsYXRlZFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXM/LmZpbmRcblxuICAgICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFiaWxpdHlBY3Rpb24ubGVuZ3RoIDwgMSkge1xuICAgICAgICBhdXRob3JpemVkSWRzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIG5ldyBTZXQoKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHJlbGF0ZWRNb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgaWRlbnRpdGllcyA9IHJlbGF0ZWRNb2RlbHMubWFwKChtb2RlbCkgPT4gbW9kZWwuaWQoKSlcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWRJZHMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxBdXRob3JpemVkSWRlbnRpdHlTZXQoe1xuICAgICAgICBpZGVudGl0aWVzLFxuICAgICAgICBtb2RlbENsYXNzOiByZWxhdGVkTW9kZWxDbGFzcyxcbiAgICAgICAgcHJpbWFyeUtleSxcbiAgICAgICAgcXVlcnk6IHJlbGF0ZWRNb2RlbENsYXNzLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbilcbiAgICAgIH0pXG5cbiAgICAgIHByaW1hcnlLZXlzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIHByaW1hcnlLZXkpXG4gICAgICBhdXRob3JpemVkSWRzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIGF1dGhvcml6ZWRJZHMpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGVscy5maWx0ZXIoKG1vZGVsKSA9PiB7XG4gICAgICBjb25zdCByZWxhdGVkTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWRJZHMgPSBhdXRob3JpemVkSWRzQnlDbGFzcy5nZXQocmVsYXRlZE1vZGVsQ2xhc3MpXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gcHJpbWFyeUtleXNCeUNsYXNzLmdldChyZWxhdGVkTW9kZWxDbGFzcylcblxuICAgICAgaWYgKCFhdXRob3JpemVkSWRzIHx8ICFwcmltYXJ5S2V5KSByZXR1cm4gZmFsc2VcblxuICAgICAgcmV0dXJuIGF1dGhvcml6ZWRJZHMuaGFzKG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIG1vZGVsLmlkKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBzZXJpYWxpemFibGUgZnJvbnRlbmQgbW9kZWwuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHByZWxvYWRlZCB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZhbHVlIGlzIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gV2hldGhlciB2YWx1ZSBiZWhhdmVzIGxpa2UgYSBtb2RlbC5cbiAgICovXG4gIGlzU2VyaWFsaXphYmxlRnJvbnRlbmRNb2RlbCh2YWx1ZSkge1xuICAgIHJldHVybiBCb29sZWFuKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHZhbHVlKS5hdHRyaWJ1dGVzID09PSBcImZ1bmN0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUgZnJvbnRlbmQgbW9kZWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gbW9kZWxzIC0gTW9kZWxzIHRvIHNlcmlhbGl6ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10+fSAtIFNlcmlhbGl6ZWQgbW9kZWwgcGF5bG9hZHMuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVGcm9udGVuZE1vZGVscyhtb2RlbHMpIHtcbiAgICBpZiAobW9kZWxzLmxlbmd0aCA8IDEpIHJldHVybiBbXVxuXG4gICAgLyoqXG4gICAgICogUHJlbG9hZGVkIHJlbGF0aW9uc2hpcHMgcGVyIG1vZGVsLlxuICAgICAqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbCA9IEFycmF5LmZyb20oe2xlbmd0aDogbW9kZWxzLmxlbmd0aH0sICgpID0+ICh7fSkpXG5cbiAgICAvKipcbiAgICAgKiBDb2xsZWN0aW9uIHJlbGF0aW9uc2hpcCBlbnRyaWVzLlxuICAgICAqIEB0eXBlIHtBcnJheTx7bG9hZGVkTW9kZWxzOiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10sIG1vZGVsSW5kZXg6IG51bWJlciwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nfT59ICovXG4gICAgY29uc3QgY29sbGVjdGlvblJlbGF0aW9uc2hpcEVudHJpZXMgPSBbXVxuICAgIC8qKlxuICAgICAqIFNpbmd1bGFyIHJlbGF0aW9uc2hpcCBlbnRyaWVzLlxuICAgICAqIEB0eXBlIHtBcnJheTx7bG9hZGVkTW9kZWw6IGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIG1vZGVsSW5kZXg6IG51bWJlciwgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nfT59ICovXG4gICAgY29uc3Qgc2luZ3VsYXJSZWxhdGlvbnNoaXBFbnRyaWVzID0gW11cblxuICAgIG1vZGVscy5mb3JFYWNoKChtb2RlbCwgbW9kZWxJbmRleCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcHNNYXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuICAgICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLl9zZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUZvck1vZGVsKG1vZGVsKVxuICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gcmVzb3VyY2UgPyByZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24oKSA6IG51bGxcbiAgICAgIGNvbnN0IGV4cG9zZWRSZWxhdGlvbnNoaXBzID0gbmV3IFNldChcbiAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uICYmIEFycmF5LmlzQXJyYXkocmVzb3VyY2VDb25maWd1cmF0aW9uLnJlbGF0aW9uc2hpcHMpXG4gICAgICAgICAgPyByZXNvdXJjZUNvbmZpZ3VyYXRpb24ucmVsYXRpb25zaGlwc1xuICAgICAgICAgIDogW11cbiAgICAgIClcblxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHJlbGF0aW9uc2hpcHNNYXApIHtcbiAgICAgICAgaWYgKCFleHBvc2VkUmVsYXRpb25zaGlwcy5oYXMocmVsYXRpb25zaGlwTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgbG9hZGVkUmVsYXRpb25zaGlwID0gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZGVkUmVsYXRpb25zaGlwKSkge1xuICAgICAgICAgIGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzLnB1c2goe2xvYWRlZE1vZGVsczogbG9hZGVkUmVsYXRpb25zaGlwLCBtb2RlbEluZGV4LCByZWxhdGlvbnNoaXBOYW1lfSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMuaXNTZXJpYWxpemFibGVGcm9udGVuZE1vZGVsKGxvYWRlZFJlbGF0aW9uc2hpcCkpIHtcbiAgICAgICAgICBzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMucHVzaCh7bG9hZGVkTW9kZWw6IGxvYWRlZFJlbGF0aW9uc2hpcCwgbW9kZWxJbmRleCwgcmVsYXRpb25zaGlwTmFtZX0pXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFttb2RlbEluZGV4XVtyZWxhdGlvbnNoaXBOYW1lXSA9IGxvYWRlZFJlbGF0aW9uc2hpcCA9PSB1bmRlZmluZWQgPyBudWxsIDogbG9hZGVkUmVsYXRpb25zaGlwXG4gICAgICB9XG4gICAgfSlcblxuICAgIGlmIChjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBhbGxDb2xsZWN0aW9uTW9kZWxzID0gY29sbGVjdGlvblJlbGF0aW9uc2hpcEVudHJpZXMuZmxhdE1hcCgoZW50cnkpID0+IGVudHJ5LmxvYWRlZE1vZGVscylcbiAgICAgIGNvbnN0IHNlcmlhbGl6YWJsZUNvbGxlY3Rpb25Nb2RlbHMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaWx0ZXJTZXJpYWxpemFibGVSZWxhdGVkTW9kZWxzKHtcbiAgICAgICAgbW9kZWxzOiBhbGxDb2xsZWN0aW9uTW9kZWxzLFxuICAgICAgICByZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb246IHRydWVcbiAgICAgIH0pXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzU2V0ID0gbmV3IFNldChzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzKVxuXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcEVudHJ5IG9mIGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IGFsbG93ZWRNb2RlbHMgPSByZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbHMuZmlsdGVyKChyZWxhdGVkTW9kZWwpID0+IHNlcmlhbGl6YWJsZUNvbGxlY3Rpb25Nb2RlbHNTZXQuaGFzKHJlbGF0ZWRNb2RlbCkpXG4gICAgICAgIGNvbnN0IHNlcmlhbGl6ZWRSZWxhdGVkTW9kZWxzID0gYXdhaXQgdGhpcy5zZXJpYWxpemVGcm9udGVuZE1vZGVscyhhbGxvd2VkTW9kZWxzKVxuXG4gICAgICAgIHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFtyZWxhdGlvbnNoaXBFbnRyeS5tb2RlbEluZGV4XVtyZWxhdGlvbnNoaXBFbnRyeS5yZWxhdGlvbnNoaXBOYW1lXSA9IHNlcmlhbGl6ZWRSZWxhdGVkTW9kZWxzXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBhbGxTaW5ndWxhck1vZGVscyA9IHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sb2FkZWRNb2RlbClcbiAgICAgIGNvbnN0IHNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyU2VyaWFsaXphYmxlUmVsYXRlZE1vZGVscyh7XG4gICAgICAgIG1vZGVsczogYWxsU2luZ3VsYXJNb2RlbHMsXG4gICAgICAgIHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvbjogZmFsc2VcbiAgICAgIH0pXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVTaW5ndWxhck1vZGVsc1NldCA9IG5ldyBTZXQoc2VyaWFsaXphYmxlU2luZ3VsYXJNb2RlbHMpXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwRW50cnkgb2Ygc2luZ3VsYXJSZWxhdGlvbnNoaXBFbnRyaWVzKSB7XG4gICAgICAgIGlmICghc2VyaWFsaXphYmxlU2luZ3VsYXJNb2RlbHNTZXQuaGFzKHJlbGF0aW9uc2hpcEVudHJ5LmxvYWRlZE1vZGVsKSkge1xuICAgICAgICAgIHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFtyZWxhdGlvbnNoaXBFbnRyeS5tb2RlbEluZGV4XVtyZWxhdGlvbnNoaXBFbnRyeS5yZWxhdGlvbnNoaXBOYW1lXSA9IG51bGxcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gKGF3YWl0IHRoaXMuc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMoW3JlbGF0aW9uc2hpcEVudHJ5LmxvYWRlZE1vZGVsXSkpWzBdXG4gICAgICAgIHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFtyZWxhdGlvbnNoaXBFbnRyeS5tb2RlbEluZGV4XVtyZWxhdGlvbnNoaXBFbnRyeS5yZWxhdGlvbnNoaXBOYW1lXSA9IHNlcmlhbGl6ZWRNb2RlbFxuICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNlcmlhbGl6ZWQgbW9kZWxzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXX0gKi9cbiAgICBjb25zdCBzZXJpYWxpemVkTW9kZWxzID0gW11cblxuICAgIGZvciAoY29uc3QgW21vZGVsSW5kZXgsIG1vZGVsXSBvZiBtb2RlbHMuZW50cmllcygpKSB7XG4gICAgICBjb25zdCBzZXJpYWxpemVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZXMobW9kZWwpXG4gICAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gcHJlbG9hZGVkUmVsYXRpb25zaGlwc1Blck1vZGVsW21vZGVsSW5kZXhdXG4gICAgICBjb25zdCBhc3NvY2lhdGlvbkNvdW50cyA9IG1vZGVsLmFzc29jaWF0aW9uQ291bnRzKClcbiAgICAgIGNvbnN0IHF1ZXJ5RGF0YVZhbHVlcyA9IG1vZGVsLnF1ZXJ5RGF0YVZhbHVlcygpXG4gICAgICBjb25zdCBjb21wdXRlZEFiaWxpdGllcyA9IG1vZGVsLmNvbXB1dGVkQWJpbGl0aWVzKClcbiAgICAgIGNvbnN0IGhhc0NvdW50cyA9IE9iamVjdC5rZXlzKGFzc29jaWF0aW9uQ291bnRzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNRdWVyeURhdGEgPSBPYmplY3Qua2V5cyhxdWVyeURhdGFWYWx1ZXMpLmxlbmd0aCA+IDBcbiAgICAgIGNvbnN0IGhhc0FiaWxpdGllcyA9IE9iamVjdC5rZXlzKGNvbXB1dGVkQWJpbGl0aWVzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNQcmVsb2FkZWQgPSBPYmplY3Qua2V5cyhwcmVsb2FkZWRSZWxhdGlvbnNoaXBzKS5sZW5ndGggPiAwXG5cbiAgICAgIGlmICghaGFzUHJlbG9hZGVkICYmICFoYXNDb3VudHMgJiYgIWhhc1F1ZXJ5RGF0YSAmJiAhaGFzQWJpbGl0aWVzKSB7XG4gICAgICAgIHNlcmlhbGl6ZWRNb2RlbHMucHVzaChzZXJpYWxpemVkQXR0cmlidXRlcylcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBTZXJpYWxpemVkLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB7Li4uc2VyaWFsaXplZEF0dHJpYnV0ZXN9XG5cbiAgICAgIGlmIChoYXNQcmVsb2FkZWQpIHNlcmlhbGl6ZWQuX19wcmVsb2FkZWRSZWxhdGlvbnNoaXBzID0gcHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuICAgICAgaWYgKGhhc0NvdW50cykgc2VyaWFsaXplZC5fX2Fzc29jaWF0aW9uQ291bnRzID0gYXNzb2NpYXRpb25Db3VudHNcbiAgICAgIGlmIChoYXNRdWVyeURhdGEpIHNlcmlhbGl6ZWQuX19xdWVyeURhdGEgPSBxdWVyeURhdGFWYWx1ZXNcbiAgICAgIGlmIChoYXNBYmlsaXRpZXMpIHNlcmlhbGl6ZWQuX19hYmlsaXRpZXMgPSBjb21wdXRlZEFiaWxpdGllc1xuXG4gICAgICBzZXJpYWxpemVkTW9kZWxzLnB1c2goc2VyaWFsaXplZClcbiAgICB9XG5cbiAgICByZXR1cm4gc2VyaWFsaXplZE1vZGVsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFNlcmlhbGl6ZWQgZnJvbnRlbmQgbW9kZWwgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpIHtcbiAgICBjb25zdCBzZXJpYWxpemVkTW9kZWxzID0gYXdhaXQgdGhpcy5zZXJpYWxpemVGcm9udGVuZE1vZGVscyhbbW9kZWxdKVxuXG4gICAgcmV0dXJuIHNlcmlhbGl6ZWRNb2RlbHNbMF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlbmRlciBlcnJvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGVycm9yTWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gZXJyb3IgaGFzIGJlZW4gcmVuZGVyZWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsUmVuZGVyRXJyb3IoZXJyb3JNZXNzYWdlKSB7XG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuZXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlcXVlc3QgZmFpbGVkOiAke2Vycm9yTWVzc2FnZX1gKVxuXG4gICAgY29uc3QgcmVuZGVyRXJyb3IgPSAvKiogQHR5cGUgeygoZXJyb3JNZXNzYWdlOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4pIHwgdW5kZWZpbmVkfSAqLyAoXG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykucmVuZGVyRXJyb3JcbiAgICApXG5cbiAgICBpZiAodHlwZW9mIHJlbmRlckVycm9yID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF3YWl0IHJlbmRlckVycm9yLmNhbGwodGhpcywgZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvck1lc3NhZ2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIGVycm9yTWVzc2FnZTogZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvck1lc3NhZ2UsXG4gICAgICAgIHN0YXR1czogXCJlcnJvclwiXG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBlcnJvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXJyb3JNZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFN0cnVjdHVyZWQgZXJyb3IgZmllbGRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9IFtvcHRpb25zLmRldGFpbHNdIC0gQ2xpZW50LXNhZmUgZGV0YWlscy5cbiAgICogQHBhcmFtIHtcImFwcGxpY2F0aW9uX2Vycm9yXCIgfCBcImF1dGhvcml6YXRpb25fZXJyb3JcIiB8IFwiaW50ZXJuYWxfZXJyb3JcIiB8IFwicmVjb3JkX25vdF9mb3VuZFwiIHwgXCJ2YWxpZGF0aW9uX2Vycm9yXCJ9IFtvcHRpb25zLmVycm9yVHlwZV0gLSBTdGFibGUgY2xpZW50LWZhY2luZyBlcnJvciBjYXRlZ29yeS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBFcnJvciBwYXlsb2FkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChlcnJvck1lc3NhZ2UsIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi4ob3B0aW9ucy5kZXRhaWxzID8ge2RldGFpbHM6IG9wdGlvbnMuZGV0YWlsc30gOiB7fSksXG4gICAgICBlcnJvck1lc3NhZ2UsXG4gICAgICAuLi4ob3B0aW9ucy5lcnJvclR5cGUgPyB7ZXJyb3JUeXBlOiBvcHRpb25zLmVycm9yVHlwZX0gOiB7fSksXG4gICAgICBzdGF0dXM6IFwiZXJyb3JcIlxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsaWVudCBzYWZlIGVycm9yIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xpZW50LXNhZmUgZXJyb3IgcGF5bG9hZC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JQYXlsb2FkKCkge1xuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvck1lc3NhZ2UpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGZyb250ZW5kLW1vZGVsIGVuZHBvaW50IGVycm9yIGNvbnRleHQgZm9yIGxvZ2dpbmcgYW5kIGNsaWVudCBwYXlsb2FkIHJlcG9ydGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBFcnJvciBjb250ZXh0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjdGlvbiAtIEVuZHBvaW50L2FjdGlvbiBsYWJlbC5cbiAgICogQHBhcmFtIHt1bmtub3dufSBhcmdzLmVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwiIHwgXCJjdXN0b20tY29tbWFuZFwifSBbYXJncy5jb21tYW5kVHlwZV0gLSBGcm9udGVuZC1tb2RlbCBjb21tYW5kIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBbYXJncy5tb2RlbF0gLSBSZXF1ZXN0IG1vZGVsIG5hbWUgd2hlbiBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBbYXJncy5yZXF1ZXN0SWRdIC0gQmF0Y2ggcmVxdWVzdCBpZCB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dH0gRnJvbnRlbmQtbW9kZWwgZW5kcG9pbnQgZXJyb3IgY29udGV4dC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCh7YWN0aW9uLCBjb21tYW5kVHlwZSwgZXJyb3IsIG1vZGVsLCByZXF1ZXN0SWR9KSB7XG4gICAgbGV0IHJlc29sdmVkTW9kZWwgPSBtb2RlbFxuICAgIGNvbnN0IGV4cGVjdGVkRXJyb3IgPSBmcm9udGVuZE1vZGVsRXhwZWN0ZWRFcnJvcihlcnJvcilcblxuICAgIGlmICghcmVzb2x2ZWRNb2RlbCkge1xuICAgICAgY29uc3QgY2FjaGVkUGFyYW1zID0gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlIHx8IHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNcbiAgICAgIGNvbnN0IHBhcmFtc01vZGVsID0gY2FjaGVkUGFyYW1zID8gY2FjaGVkUGFyYW1zLm1vZGVsIDogdW5kZWZpbmVkXG4gICAgICByZXNvbHZlZE1vZGVsID0gdHlwZW9mIHBhcmFtc01vZGVsID09PSBcInN0cmluZ1wiICYmIHBhcmFtc01vZGVsLmxlbmd0aCA+IDAgPyBwYXJhbXNNb2RlbCA6IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBhY3Rpb24sXG4gICAgICBjb21tYW5kVHlwZSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIC4uLihleHBlY3RlZEVycm9yID8ge30gOiB7Y29ycmVsYXRpb25JZDogcmFuZG9tVVVJRCgpfSksXG4gICAgICBleHBlY3RlZEVycm9yLFxuICAgICAgZnJvbnRlbmRNb2RlbEVuZHBvaW50OiB0cnVlLFxuICAgICAgbW9kZWw6IHJlc29sdmVkTW9kZWwsXG4gICAgICByZXF1ZXN0SWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjbGllbnQgZXJyb3IgcGF5bG9hZCBmb3IgZXJyb3IuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0IHwgdW5kZWZpbmVkfSBbZW5kcG9pbnRFcnJvckNvbnRleHRdIC0gRnJvbnRlbmQtbW9kZWwgZW5kcG9pbnQgZXJyb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZD59IC0gQ2xpZW50IHBheWxvYWQgZm9yIHRoZSBjdXJyZW50IGVudmlyb25tZW50LlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlbmRwb2ludEVycm9yQ29udGV4dCkge1xuICAgIGNvbnN0IHZlbG9jaW91c01ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFZlbG9jaW91c01ldGFkYXRhRm9yRXJyb3IoZXJyb3IpXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfSAqL1xuICAgIGNvbnN0IHNhZmVFcnJvclBheWxvYWQgPSB7fVxuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgICBpZiAoZXJyb3IuZXJyb3JUeXBlKSBzYWZlRXJyb3JQYXlsb2FkLmVycm9yVHlwZSA9IGVycm9yLmVycm9yVHlwZVxuICAgICAgaWYgKGVycm9yLmRldGFpbHMpIHNhZmVFcnJvclBheWxvYWQuZGV0YWlscyA9IGVycm9yLmRldGFpbHNcbiAgICB9IGVsc2UgaWYgKGVycm9yIGluc3RhbmNlb2YgUmVjb3JkTm90Rm91bmRFcnJvcikge1xuICAgICAgc2FmZUVycm9yUGF5bG9hZC5lcnJvclR5cGUgPSBcInJlY29yZF9ub3RfZm91bmRcIlxuICAgIH0gZWxzZSBpZiAodmVsb2Npb3VzTWV0YWRhdGEpIHtcbiAgICAgIGlmICh0eXBlb2YgdmVsb2Npb3VzTWV0YWRhdGEuZXJyb3JUeXBlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHNhZmVFcnJvclBheWxvYWQuZXJyb3JUeXBlID0gdmVsb2Npb3VzTWV0YWRhdGEuZXJyb3JUeXBlXG4gICAgICB9XG4gICAgICBpZiAoaXNQbGFpbk9iamVjdCh2ZWxvY2lvdXNNZXRhZGF0YS5kZXRhaWxzKSkge1xuICAgICAgICBzYWZlRXJyb3JQYXlsb2FkLmRldGFpbHMgPSB2ZWxvY2lvdXNNZXRhZGF0YS5kZXRhaWxzXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IHZhbGlkYXRpb25FcnJvcnNQYXlsb2FkID0ge31cblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikge1xuICAgICAgY29uc3QgdmFsaWRhdGlvbkVycm9ycyA9IGVycm9yLmdldFZhbGlkYXRpb25FcnJvcnMoKVxuICAgICAgY29uc3QgbW9kZWwgPSBlcnJvci5nZXRNb2RlbCgpXG4gICAgICAvKipcbiAgICAgICAqIFN0cnVjdHVyZWQgZXJyb3JzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHt0eXBlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgZnVsbE1lc3NhZ2U6IHN0cmluZ31bXT59ICovXG4gICAgICBjb25zdCBzdHJ1Y3R1cmVkRXJyb3JzID0ge31cblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIGluIHZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICAgICAgc3RydWN0dXJlZEVycm9yc1thdHRyaWJ1dGVOYW1lXSA9IHZhbGlkYXRpb25FcnJvcnNbYXR0cmlidXRlTmFtZV0ubWFwKGVyciA9PiAoe1xuICAgICAgICAgIHR5cGU6IGVyci50eXBlLFxuICAgICAgICAgIG1lc3NhZ2U6IGVyci5tZXNzYWdlLFxuICAgICAgICAgIGZ1bGxNZXNzYWdlOiBgJHttb2RlbC5nZXRNb2RlbENsYXNzKCkuaHVtYW5BdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpfSAke2Vyci5tZXNzYWdlfWBcbiAgICAgICAgfSkpXG4gICAgICB9XG5cbiAgICAgIHZhbGlkYXRpb25FcnJvcnNQYXlsb2FkID0ge1xuICAgICAgICBlcnJvclR5cGU6IFwidmFsaWRhdGlvbl9lcnJvclwiLFxuICAgICAgICB2YWxpZGF0aW9uRXJyb3JzOiBzdHJ1Y3R1cmVkRXJyb3JzXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVwb3J0ZXJQYXlsb2FkID0gYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuY2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3Ioe1xuICAgICAgY29udGV4dDogZW5kcG9pbnRFcnJvckNvbnRleHQgfHwge2NvbnRyb2xsZXI6IHRoaXMuY29uc3RydWN0b3IubmFtZX0sXG4gICAgICBlcnJvcjogbm9ybWFsaXplZEVycm9yLFxuICAgICAgcmVxdWVzdDogdGhpcy5nZXRSZXF1ZXN0KClcbiAgICB9KVxuXG4gICAgaWYgKCF0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpKSB7XG4gICAgICBkZWxldGUgcmVwb3J0ZXJQYXlsb2FkLmRlYnVnQmFja3RyYWNlXG4gICAgICBkZWxldGUgcmVwb3J0ZXJQYXlsb2FkLmRlYnVnRXJyb3JDbGFzc1xuICAgICAgZGVsZXRlIHJlcG9ydGVyUGF5bG9hZC5kZWJ1Z0Vycm9yTWVzc2FnZVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAuLi5yZXBvcnRlclBheWxvYWQsXG4gICAgICAuLi50aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoZnJvbnRlbmRNb2RlbENsaWVudE1lc3NhZ2VGb3JFcnJvcihcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKClcbiAgICAgICkpLFxuICAgICAgLi4uZnJvbnRlbmRNb2RlbERlYnVnUGF5bG9hZEZvckVycm9yKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIGVycm9yXG4gICAgICB9KSxcbiAgICAgIC4uLih2ZWxvY2lvdXNNZXRhZGF0YSA/IHt2ZWxvY2lvdXM6IHZlbG9jaW91c01ldGFkYXRhfSA6IHt9KSxcbiAgICAgIC4uLnNhZmVFcnJvclBheWxvYWQsXG4gICAgICAuLi52YWxpZGF0aW9uRXJyb3JzUGF5bG9hZCxcbiAgICAgIC4uLighZW5kcG9pbnRFcnJvckNvbnRleHQ/LmV4cGVjdGVkRXJyb3IgJiYgZW5kcG9pbnRFcnJvckNvbnRleHQ/LmNvcnJlbGF0aW9uSWRcbiAgICAgICAgPyB7Y29ycmVsYXRpb25JZDogZW5kcG9pbnRFcnJvckNvbnRleHQuY29ycmVsYXRpb25JZCwgZXJyb3JUeXBlOiBcImludGVybmFsX2Vycm9yXCJ9XG4gICAgICAgIDoge30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgbG9nIGVuZHBvaW50IGVycm9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVycm9yIGxvZyBhcmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dH0gYXJncy5lcnJvckNvbnRleHQgLSBTaGFyZWQgY2xpZW50L2xvZ2dpbmcgZXJyb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgbG9nZ2luZy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSkge1xuICAgIC8vIEV4cGVjdGVkIHVzZXItZmxvdyBlcnJvcnMgYXJlIHN1cmZhY2VkIHRvIGNsaWVudHMgYnlcbiAgICAvLyBmcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IsIGJ1dCBza2lwcGVkIGhlcmUgc28gbW9uaXRvcmluZ1xuICAgIC8vIHN0YXlzIGZvY3VzZWQgb24gcmVhbCBiYWNrZW5kIGZhaWx1cmVzLlxuICAgIGlmIChlcnJvckNvbnRleHQuZXhwZWN0ZWRFcnJvcikgcmV0dXJuXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCByZWRhY3RvciA9IGNvbmZpZ3VyYXRpb24uZ2V0TG9nUmVkYWN0b3IoKVxuICAgIGNvbnN0IHJlcXVlc3RUaW1pbmcgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKClcbiAgICBjb25zdCBzZW5zaXRpdmVWYWx1ZXMgPSByZXF1ZXN0VGltaW5nID8gcmVxdWVzdFRpbWluZy5nZXRMb2dTZW5zaXRpdmVWYWx1ZXMoKSA6IG5ldyBTZXQoKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuICAgIGNvbnN0IHJlZGFjdGVkRXJyb3IgPSByZWRhY3Rvci5yZWRhY3RFcnJvcihub3JtYWxpemVkRXJyb3IsIHNlbnNpdGl2ZVZhbHVlcylcbiAgICBjb25zdCByZWRhY3RlZENvbnRleHQgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dH0gKi8gKHJlZGFjdG9yLnJlZGFjdFN0cnVjdHVyZWQoZXJyb3JDb250ZXh0LCBzZW5zaXRpdmVWYWx1ZXMpKVxuXG4gICAgYXdhaXQgdGhpcy5sb2dnZXIuZXJyb3IoKCkgPT4gW1wiRnJvbnRlbmQgbW9kZWwgZW5kcG9pbnQgcmVxdWVzdCBmYWlsZWRcIiwge1xuICAgICAgYWN0aW9uOiByZWRhY3RlZENvbnRleHQuYWN0aW9uLFxuICAgICAgY29tbWFuZFR5cGU6IHJlZGFjdGVkQ29udGV4dC5jb21tYW5kVHlwZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHJlZGFjdGVkQ29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgZXJyb3JCYWNrdHJhY2U6IHJlZGFjdGVkRXJyb3Iuc3RhY2ssXG4gICAgICBlcnJvckNsYXNzOiByZWRhY3RlZEVycm9yLm5hbWUsXG4gICAgICBlcnJvck1lc3NhZ2U6IHJlZGFjdGVkRXJyb3IubWVzc2FnZSxcbiAgICAgIG1vZGVsOiByZWRhY3RlZENvbnRleHQubW9kZWwsXG4gICAgICByZXF1ZXN0SWQ6IHJlZGFjdGVkQ29udGV4dC5yZXF1ZXN0SWRcbiAgICB9XSlcblxuICAgIC8vIFN1cmZhY2UgZ2VudWluZWx5IHVuZXhwZWN0ZWQgYmFja2VuZCBmYWlsdXJlcyBvbiB0aGUgZnJhbWV3b3JrLWVycm9yXG4gICAgLy8gY2hhbm5lbCBzbyBwcm9jZXNzLWxldmVsIGJ1ZyByZXBvcnRlcnMgY2FwdHVyZSB0aGVtLCBpbnN0ZWFkIG9mIHRoZVxuICAgIC8vIGNvbnRyb2xsZXIgc2lsZW50bHkgc3dhbGxvd2luZyB0aGVtIGJlaGluZCB0aGUgZ2VuZXJpYyBcIlJlcXVlc3RcbiAgICAvLyBmYWlsZWQuXCIgY2xpZW50IG1lc3NhZ2UuXG4gICAgY29uc3QgZXJyb3JQYXlsb2FkID0ge1xuICAgICAgY29ycmVsYXRpb25JZDogcmVkYWN0ZWRDb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICBjb250ZXh0OiByZWRhY3RlZENvbnRleHQsXG4gICAgICBlcnJvcjogcmVkYWN0ZWRFcnJvcixcbiAgICAgIHJlcXVlc3Q6IHRoaXMuZ2V0UmVxdWVzdCgpLFxuICAgICAgcmVxdWVzdERldGFpbHM6IHJlcXVlc3REZXRhaWxzKHRoaXMuZ2V0UmVxdWVzdCgpLCB7cmVkYWN0b3IsIHNlbnNpdGl2ZVZhbHVlc30pXG4gICAgfVxuXG4gICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RXJyb3JFdmVudHMoKS5lbWl0KFwiZnJhbWV3b3JrLWVycm9yXCIsIGVycm9yUGF5bG9hZClcbiAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJhbGwtZXJyb3JcIiwgey4uLmVycm9yUGF5bG9hZCwgZXJyb3JUeXBlOiBcImZyYW1ld29yay1lcnJvclwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlbmRlciBjb21tYW5kIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVzcG9uc2UgaGFzIGJlZW4gcmVuZGVyZWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKGFjdGlvbikge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZChhY3Rpb24pXG4gICAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VQYXlsb2FkLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe2FjdGlvbiwgY29tbWFuZFR5cGU6IGFjdGlvbiwgZXJyb3J9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY29tbWFuZCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ29tbWFuZFBheWxvYWQoYWN0aW9uKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpXG5cbiAgICBpZiAoIShhd2FpdCB0aGlzLnJ1bkZyb250ZW5kTW9kZWxCZWZvcmVBY3Rpb24oYWN0aW9uKSkpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcblxuICAgIGlmIChhY3Rpb24gPT09IFwiaW5kZXhcIikge1xuICAgICAgaWYgKHRoaXMuZnJvbnRlbmRNb2RlbENvdW50UmVxdWVzdGVkKCkpIHtcbiAgICAgICAgaWYgKCEoYXdhaXQgcmVzb3VyY2Uuc3VwcG9ydHNDb3VudChcImluZGV4XCIpKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvdW50IGlzIG5vdCBzdXBwb3J0ZWQgd2hlbiByZXNvdXJjZSByZWNvcmRzIGFyZSBjdXN0b21pemVkXCIpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvdW50OiBhd2FpdCByZXNvdXJjZS5jb3VudCgpLFxuICAgICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwbHVjayA9IHRoaXMuZnJvbnRlbmRNb2RlbFBsdWNrKClcblxuICAgICAgaWYgKHBsdWNrLmxlbmd0aCA+IDApIHtcbiAgICAgICAgaWYgKCEoYXdhaXQgcmVzb3VyY2Uuc3VwcG9ydHNQbHVjayhcImluZGV4XCIpKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInBsdWNrIGlzIG5vdCBzdXBwb3J0ZWQgd2hlbiByZXNvdXJjZSByZWNvcmRzIGFyZSBjdXN0b21pemVkXCIpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB2YWx1ZXMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxQbHVja1ZhbHVlcyh7XG4gICAgICAgICAgcGx1Y2ssXG4gICAgICAgICAgcXVlcnk6IHJlc291cmNlLmluZGV4UXVlcnkoKVxuICAgICAgICB9KVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgICB2YWx1ZXNcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbHMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZWNvcmRzKClcbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbXB1dGVBYmlsaXRpZXMobW9kZWxzKVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVscyA9IGF3YWl0IFByb21pc2UuYWxsKG1vZGVscy5tYXAoYXN5bmMgKG1vZGVsKSA9PiBhd2FpdCByZXNvdXJjZS5zZXJpYWxpemUobW9kZWwsIFwiaW5kZXhcIikpKVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBtb2RlbHM6IHNlcmlhbGl6ZWRNb2RlbHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuICAgIGxldCBpZCA9IHBhcmFtcy5pZFxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJjcmVhdGVcIikge1xuICAgICAgY29uc3QgbXV0YXRpb25BdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbE11dGF0aW9uQXR0cmlidXRlcyhwYXJhbXMpXG4gICAgICBpZiAodHlwZW9mIG11dGF0aW9uQXR0cmlidXRlcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChtdXRhdGlvbkF0dHJpYnV0ZXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ3JlYXRlUmVjb3JkKFxuICAgICAgICBtdXRhdGlvbkF0dHJpYnV0ZXMuYXR0cmlidXRlcyxcbiAgICAgICAgbXV0YXRpb25BdHRyaWJ1dGVzLm5lc3RlZEF0dHJpYnV0ZXMsXG4gICAgICAgIG11dGF0aW9uQXR0cmlidXRlcy5hdHRhY2htZW50c1xuICAgICAgKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzZXJpYWxpemVkTW9kZWwgPSBhd2FpdCByZXNvdXJjZS5zZXJpYWxpemUobW9kZWwsIFwiY3JlYXRlXCIpXG5cbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2VzcyhzZXJpYWxpemVkTW9kZWwpXG4gICAgfVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpICYmICgodHlwZW9mIGlkICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikgfHwgYCR7aWR9YC5sZW5ndGggPCAxKSkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIG1vZGVsIGlkLlwiLCB7ZXJyb3JUeXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpICYmIHR5cGVvZiBpZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBpZCA9IG1vZGVsUHJpbWFyeUtleVZhbHVlRnJvbUNhY2hlS2V5KHByaW1hcnlLZXksIGlkKVxuICAgICAgfVxuXG4gICAgICBtb2RlbFByaW1hcnlLZXlDb25kaXRpb25zKHByaW1hcnlLZXksIGlkKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIFR5cGVFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoZXJyb3IubWVzc2FnZSwge2Vycm9yVHlwZTogXCJ2YWxpZGF0aW9uX2Vycm9yXCJ9KVxuICAgIH1cblxuICAgIGlmIChhY3Rpb24gPT09IFwiYXR0YWNoXCIpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnROYW1lID0gcGFyYW1zLmF0dGFjaG1lbnROYW1lXG4gICAgICBjb25zdCBhdHRhY2htZW50SW5wdXQgPSBwYXJhbXMuYXR0YWNobWVudFxuXG4gICAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnROYW1lICE9PSBcInN0cmluZ1wiIHx8IGF0dGFjaG1lbnROYW1lLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIGF0dGFjaG1lbnROYW1lLlwiKVxuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnRJbnB1dCA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgYXR0YWNobWVudCBpbnB1dC5cIilcbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwiYXR0YWNoXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5hdHRhY2goYXR0YWNobWVudElucHV0KVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgdGhpcy5zZXJpYWxpemVGcm9udGVuZE1vZGVsKG1vZGVsKVxuXG4gICAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFNlcmlhbGl6ZWRNb2RlbFN1Y2Nlc3Moc2VyaWFsaXplZE1vZGVsKVxuICAgIH1cblxuICAgIGlmIChhY3Rpb24gPT09IFwiZG93bmxvYWRcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBhcmFtcyA9IGZyb250ZW5kTW9kZWxBdHRhY2htZW50UGFyYW1zKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudFBhcmFtcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChhdHRhY2htZW50UGFyYW1zKVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJkb3dubG9hZFwiLCBpZClcblxuICAgICAgaWYgKCFtb2RlbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGAke21vZGVsQ2xhc3MubmFtZX0gbm90IGZvdW5kLmAsIHtlcnJvclR5cGU6IFwicmVjb3JkX25vdF9mb3VuZFwifSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgZG93bmxvYWRlZEF0dGFjaG1lbnQgPSBhd2FpdCBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudE5hbWUpLmRvd25sb2FkKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudElkKVxuXG4gICAgICBpZiAoIWRvd25sb2FkZWRBdHRhY2htZW50KSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBdHRhY2htZW50IG5vdCBmb3VuZC5cIiwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBhdHRhY2htZW50OiB7XG4gICAgICAgICAgYnl0ZVNpemU6IGRvd25sb2FkZWRBdHRhY2htZW50LmJ5dGVTaXplKCksXG4gICAgICAgICAgY29udGVudEJhc2U2NDogZG93bmxvYWRlZEF0dGFjaG1lbnQuY29udGVudCgpLnRvU3RyaW5nKFwiYmFzZTY0XCIpLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBkb3dubG9hZGVkQXR0YWNobWVudC5jb250ZW50VHlwZSgpLFxuICAgICAgICAgIGZpbGVuYW1lOiBkb3dubG9hZGVkQXR0YWNobWVudC5maWxlbmFtZSgpLFxuICAgICAgICAgIGlkOiBkb3dubG9hZGVkQXR0YWNobWVudC5pZCgpLFxuICAgICAgICAgIHVybDogZG93bmxvYWRlZEF0dGFjaG1lbnQudXJsKClcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhY3Rpb24gPT09IFwidXJsXCIpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRQYXJhbXMgPSBmcm9udGVuZE1vZGVsQXR0YWNobWVudFBhcmFtcyhwYXJhbXMpXG4gICAgICBpZiAodHlwZW9mIGF0dGFjaG1lbnRQYXJhbXMgPT09IFwic3RyaW5nXCIpIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYXR0YWNobWVudFBhcmFtcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwidXJsXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCB1cmwgPSBhd2FpdCBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudE5hbWUpLnVybChhdHRhY2htZW50UGFyYW1zLmF0dGFjaG1lbnRJZClcblxuICAgICAgaWYgKCF1cmwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkF0dGFjaG1lbnQgVVJMIG5vdCBhdmFpbGFibGUuXCIpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCIsXG4gICAgICAgIHVybFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChhY3Rpb24gPT09IFwiYXR0YWNobWVudExpc3RcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBhcmFtcyA9IGZyb250ZW5kTW9kZWxBdHRhY2htZW50UGFyYW1zKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudFBhcmFtcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChhdHRhY2htZW50UGFyYW1zKVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJhdHRhY2htZW50TGlzdFwiLCBpZClcblxuICAgICAgaWYgKCFtb2RlbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGAke21vZGVsQ2xhc3MubmFtZX0gbm90IGZvdW5kLmAsIHtlcnJvclR5cGU6IFwicmVjb3JkX25vdF9mb3VuZFwifSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgYXR0YWNobWVudHMgPSBhd2FpdCBtb2RlbC5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudE5hbWUpLmxpc3RNZXRhZGF0YSgpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGF0dGFjaG1lbnRzLFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJmaW5kXCIpIHtcbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImZpbmRcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbXB1dGVBYmlsaXRpZXMoW21vZGVsXSlcbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZShtb2RlbCwgXCJmaW5kXCIpXG5cbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2VzcyhzZXJpYWxpemVkTW9kZWwpXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cGRhdGVcIikge1xuICAgICAgY29uc3QgbXV0YXRpb25BdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbE11dGF0aW9uQXR0cmlidXRlcyhwYXJhbXMpXG4gICAgICBpZiAodHlwZW9mIG11dGF0aW9uQXR0cmlidXRlcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChtdXRhdGlvbkF0dHJpYnV0ZXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcInVwZGF0ZVwiLCBpZClcblxuICAgICAgaWYgKCFtb2RlbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGAke21vZGVsQ2xhc3MubmFtZX0gbm90IGZvdW5kLmAsIHtlcnJvclR5cGU6IFwicmVjb3JkX25vdF9mb3VuZFwifSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgdXBkYXRlZE1vZGVsID0gYXdhaXQgcmVzb3VyY2UudXBkYXRlKG1vZGVsLCBtdXRhdGlvbkF0dHJpYnV0ZXMuYXR0cmlidXRlcywge1xuICAgICAgICBhdHRhY2htZW50czogbXV0YXRpb25BdHRyaWJ1dGVzLmF0dGFjaG1lbnRzLFxuICAgICAgICBjb250cm9sbGVyOiB0aGlzLFxuICAgICAgICBuZXN0ZWRBdHRyaWJ1dGVzOiBtdXRhdGlvbkF0dHJpYnV0ZXMubmVzdGVkQXR0cmlidXRlc1xuICAgICAgfSlcbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZSh1cGRhdGVkTW9kZWwsIFwidXBkYXRlXCIpXG5cbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2VzcyhzZXJpYWxpemVkTW9kZWwpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwiZGVzdHJveVwiLCBpZClcblxuICAgIGlmICghbW9kZWwpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgIH1cblxuICAgIGF3YWl0IHJlc291cmNlLmRlc3Ryb3kobW9kZWwpXG5cbiAgICByZXR1cm4ge3N0YXR1czogXCJzdWNjZXNzXCJ9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBzeW5jIGJvb3RzdHJhcC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3luYyBib290c3RyYXAgcmVzcG9uc2Ugd2l0aCBtYW5pZmVzdCBhbmQgc2lnbmVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNCb290c3RyYXAoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3Qgc3luY01hbmlmZXN0ID0gZnJvbnRlbmRNb2RlbFN5bmNNYW5pZmVzdEZvckJhY2tlbmRQcm9qZWN0cyhjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudCA9IGF3YWl0IGNyZWF0ZU9mZmxpbmVHcmFudEZyb21Cb290c3RyYXAoe1xuICAgICAgZGV2aWNlSWQ6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwRGV2aWNlSWQocGFyYW1zKSxcbiAgICAgIGdyYW50SWQ6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwR3JhbnRJZChwYXJhbXMpLFxuICAgICAgZ3JhbnRUdGxNczogY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpLm9mZmxpbmVHcmFudFR0bE1zLFxuICAgICAgbm93OiB0aGlzLmZyb250ZW5kU3luY0Jvb3RzdHJhcE5vdyhwYXJhbXMpLFxuICAgICAgcmVzb3VyY2VzOiBzeW5jTWFuaWZlc3QsXG4gICAgICBzY29wZXM6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwU2NvcGVzKHBhcmFtcyksXG4gICAgICBzaWduaW5nS2V5OiBjb25maWd1cmF0aW9uLmN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KCksXG4gICAgICB1c2VySWQ6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwVXNlcklkKClcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoe1xuICAgICAgICBvZmZsaW5lR3JhbnQsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCIsXG4gICAgICAgIHN5bmNNYW5pZmVzdFxuICAgICAgfSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGRldmljZSBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlIHwgdW5kZWZpbmVkPn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGV2aWNlIGlkLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwRGV2aWNlSWQocGFyYW1zKSB7XG4gICAgaWYgKHR5cGVvZiBwYXJhbXMuZGV2aWNlSWQgPT09IFwic3RyaW5nXCIgJiYgcGFyYW1zLmRldmljZUlkLmxlbmd0aCA+IDApIHJldHVybiBwYXJhbXMuZGV2aWNlSWRcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgYm9vdHN0cmFwIGRldmljZUlkXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZ3JhbnQgaWQgZm9yIHN5bmMgYm9vdHN0cmFwLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERldGVybWluaXN0aWMgZ3JhbnQgaWQgZm9yIHRlc3RzLCBnZW5lcmF0ZWQgaWQgb3RoZXJ3aXNlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwR3JhbnRJZChwYXJhbXMpIHtcbiAgICBpZiAodGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIgJiYgdHlwZW9mIHBhcmFtcy5ncmFudElkID09PSBcInN0cmluZ1wiKSByZXR1cm4gcGFyYW1zLmdyYW50SWRcblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBib290c3RyYXAgaXNzdWUgdGltZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge0RhdGV9IC0gSXNzdWUgdGltZS5cbiAgICovXG4gIGZyb250ZW5kU3luY0Jvb3RzdHJhcE5vdyhwYXJhbXMpIHtcbiAgICBpZiAodGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIgJiYgdHlwZW9mIHBhcmFtcy5ub3cgPT09IFwic3RyaW5nXCIpIHJldHVybiBuZXcgRGF0ZShwYXJhbXMubm93KVxuXG4gICAgcmV0dXJuIG5ldyBEYXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzeW5jIGJvb3RzdHJhcCBzY29wZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlIHwgdW5kZWZpbmVkPn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAtIEdyYW50IHNjb3Blcy5cbiAgICovXG4gIGZyb250ZW5kU3luY0Jvb3RzdHJhcFNjb3BlcyhwYXJhbXMpIHtcbiAgICBjb25zdCBzY29wZXMgPSBwYXJhbXMuc2NvcGVzXG5cbiAgICBpZiAoc2NvcGVzICYmIHR5cGVvZiBzY29wZXMgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoc2NvcGVzKSkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKHNjb3BlcylcbiAgICB9XG5cbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjdXJyZW50IHVzZXIgaWQgZm9yIHN5bmMgYm9vdHN0cmFwLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFVzZXIgaWQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBVc2VySWQoKSB7XG4gICAgY29uc3QgYWJpbGl0eSA9IHRoaXMuY3VycmVudEFiaWxpdHkoKVxuICAgIGNvbnN0IGN1cnJlbnRVc2VyID0gYWJpbGl0eT8uY3VycmVudFVzZXIoKVxuXG4gICAgaWYgKHR5cGVvZiBjdXJyZW50VXNlciA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgY3VycmVudFVzZXIgPT09IFwibnVtYmVyXCIpIHJldHVybiBTdHJpbmcoY3VycmVudFVzZXIpXG4gICAgaWYgKGN1cnJlbnRVc2VyICYmIHR5cGVvZiBjdXJyZW50VXNlciA9PT0gXCJvYmplY3RcIikge1xuICAgICAgY29uc3QgdXNlclJlY29yZCA9IC8qKiBAdHlwZSB7e2lkPzogc3RyaW5nIHwgbnVtYmVyIHwgKCgpID0+IHN0cmluZyB8IG51bWJlcil9fSAqLyAoY3VycmVudFVzZXIpXG4gICAgICBjb25zdCBpZFZhbHVlID0gdHlwZW9mIHVzZXJSZWNvcmQuaWQgPT09IFwiZnVuY3Rpb25cIiA/IHVzZXJSZWNvcmQuaWQoKSA6IHVzZXJSZWNvcmQuaWRcblxuICAgICAgaWYgKHR5cGVvZiBpZFZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBpZFZhbHVlID09PSBcIm51bWJlclwiKSByZXR1cm4gU3RyaW5nKGlkVmFsdWUpXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBib290c3RyYXAgY3VycmVudCB1c2VyXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBzeW5jIHJlcGxheS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3luYyByZXBsYXkgcmVzcG9uc2Ugd2l0aCBwZXItbXV0YXRpb24gcmVzdWx0cy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheSgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHRoaXMucGFyYW1zKCkpKVxuICAgIGNvbnN0IHNpZ25lZE11dGF0aW9ucyA9IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkTXV0YXRpb25zKHBhcmFtcylcbiAgICBjb25zdCByZXN1bHRzID0gW11cblxuICAgIGZvciAoY29uc3Qgc2lnbmVkTXV0YXRpb24gb2Ygc2lnbmVkTXV0YXRpb25zKSB7XG4gICAgICBsZXQgaWRlbXBvdGVuY3lLZXkgPSBudWxsXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlkZW1wb3RlbmN5S2V5ID0gbXV0YXRpb25JZGVtcG90ZW5jeUtleSgvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSAqLyAoc2lnbmVkTXV0YXRpb24pKVxuICAgICAgICBjb25zdCB7cmVzcG9uc2UsIHNlcnZlckNoYW5nZUZlZWRFcnJvciwgc2VydmVyQ2hhbmdlRmVlZFN0YXR1cywgc2VydmVyU2VxdWVuY2V9ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlTaWduZWRNdXRhdGlvbihzaWduZWRNdXRhdGlvbilcblxuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGlkZW1wb3RlbmN5S2V5LFxuICAgICAgICAgIHJlc3BvbnNlLFxuICAgICAgICAgIHNlcnZlckNoYW5nZUZlZWRFcnJvcixcbiAgICAgICAgICBzZXJ2ZXJDaGFuZ2VGZWVkU3RhdHVzLFxuICAgICAgICAgIHNlcnZlclNlcXVlbmNlLFxuICAgICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgICBhY3Rpb246IFwiZnJvbnRlbmRTeW5jUmVwbGF5XCIsXG4gICAgICAgICAgY29tbWFuZFR5cGU6IHNpZ25lZE11dGF0aW9uICYmIHR5cGVvZiBzaWduZWRNdXRhdGlvbiA9PT0gXCJvYmplY3RcIiAmJiBcIm11dGF0aW9uXCIgaW4gc2lnbmVkTXV0YXRpb25cbiAgICAgICAgICAgID8gLyoqIEB0eXBlIHt7bXV0YXRpb24/OiB7b3BlcmF0aW9uPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fX0gKi8gKHNpZ25lZE11dGF0aW9uKS5tdXRhdGlvbj8ub3BlcmF0aW9uXG4gICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICBtb2RlbDogc2lnbmVkTXV0YXRpb24gJiYgdHlwZW9mIHNpZ25lZE11dGF0aW9uID09PSBcIm9iamVjdFwiICYmIFwibXV0YXRpb25cIiBpbiBzaWduZWRNdXRhdGlvblxuICAgICAgICAgICAgPyAvKiogQHR5cGUge3ttdXRhdGlvbj86IHttb2RlbD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX19ICovIChzaWduZWRNdXRhdGlvbikubXV0YXRpb24/Lm1vZGVsXG4gICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgICAgcmVzcG9uc2U6IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLFxuICAgICAgICAgIHN0YXR1czogXCJlcnJvclwiXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoe1xuICAgICAgICByZXN1bHRzLFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc2lnbmVkIHJlcGxheSBtdXRhdGlvbnMgZnJvbSByZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZXMuXG4gICAqL1xuICBmcm9udGVuZFN5bmNSZXBsYXlTaWduZWRNdXRhdGlvbnMocGFyYW1zKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGFyYW1zLm11dGF0aW9ucykpIHJldHVybiBwYXJhbXMubXV0YXRpb25zXG4gICAgaWYgKHBhcmFtcy5tdXRhdGlvbikgcmV0dXJuIFtwYXJhbXMubXV0YXRpb25dXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIHJlcGxheSBtdXRhdGlvbiBvciBtdXRhdGlvbnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyBhbmQgcmVwbGF5cyBvbmUgc2lnbmVkIHN5bmMgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNpZ25lZE11dGF0aW9uIC0gU2lnbmVkIG11dGF0aW9uIGVudmVsb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7cmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2VydmVyQ2hhbmdlRmVlZEVycm9yPzogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzZXJ2ZXJDaGFuZ2VGZWVkU3RhdHVzPzogXCJlcnJvclwiLCBzZXJ2ZXJTZXF1ZW5jZTogbnVtYmVyIHwgbnVsbH0+fSAtIEZyb250ZW5kLW1vZGVsIGNvbW1hbmQgcmVzcG9uc2UgYW5kIGFwcGVuZGVkIHNlcnZlciBzZXF1ZW5jZS5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9uKHNpZ25lZE11dGF0aW9uKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3Qgc3luY0NvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLmdldFN5bmNDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBiYWNrZW5kUHVibGljS2V5ID0gc3luY0NvbmZpZ3VyYXRpb24uZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5XG5cbiAgICBpZiAoIWJhY2tlbmRQdWJsaWNLZXkpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcInN5bmMuZGV2aWNlQ2VydGlmaWNhdGVCYWNrZW5kUHVibGljS2V5IGlzIHJlcXVpcmVkIGZvciBzeW5jIHJlcGxheVwiKVxuXG4gICAgbGV0IG11dGF0aW9uXG5cbiAgICB0cnkge1xuICAgICAgbXV0YXRpb24gPSBhd2FpdCB2ZXJpZnlTaWduZWRNdXRhdGlvbih7XG4gICAgICAgIGJhY2tlbmRQdWJsaWNLZXksXG4gICAgICAgIHNpZ25lZE11dGF0aW9uOiAvKiogQHR5cGUge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSAqLyAoc2lnbmVkTXV0YXRpb24pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLCBlcnJvcilcbiAgICB9XG5cbiAgICBjb25zdCBzeW5jTWFuaWZlc3QgPSBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpXG4gICAgY29uc3Qgc3luY1Jlc291cmNlID0gc3luY01hbmlmZXN0W211dGF0aW9uLm1vZGVsXVxuXG4gICAgaWYgKCFzeW5jUmVzb3VyY2UpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgbW9kZWwgaXMgbm90IGVuYWJsZWQ6ICR7bXV0YXRpb24ubW9kZWx9YClcbiAgICBpZiAoIXN5bmNSZXNvdXJjZS5vcGVyYXRpb25zLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb3BlcmF0aW9uIGlzIG5vdCBlbmFibGVkIGZvciAke211dGF0aW9uLm1vZGVsfTogJHttdXRhdGlvbi5vcGVyYXRpb259YClcbiAgICB9XG4gICAgaWYgKHN5bmNSZXNvdXJjZS5wb2xpY3lIYXNoICE9PSBtdXRhdGlvbi5wb2xpY3lIYXNoKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IHBvbGljeSBoYXNoIG1pc21hdGNoIGZvciAke211dGF0aW9uLm1vZGVsfWApXG4gICAgfVxuXG4gICAgY29uc3Qgc2lnbmVkT2ZmbGluZUdyYW50ID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlTaWduZWRPZmZsaW5lR3JhbnQoc2lnbmVkTXV0YXRpb24pXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlWZXJpZmllZE9mZmxpbmVHcmFudCh7XG4gICAgICBzaWduZWRPZmZsaW5lR3JhbnQsXG4gICAgICBzaWduaW5nS2V5czogc3luY0NvbmZpZ3VyYXRpb24ub2ZmbGluZUdyYW50U2lnbmluZ0tleXNcbiAgICB9KVxuXG4gICAgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlWYWxpZGF0ZU9mZmxpbmVHcmFudCh7bXV0YXRpb24sIG9mZmxpbmVHcmFudCwgc3luY1Jlc291cmNlfSlcblxuICAgIGNvbnN0IGNvbW1hbmRQYXJhbXMgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRQYXJhbXMobXV0YXRpb24pXG4gICAgY29uc3QgcmVwbGF5Q29tbWFuZCA9IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEZvck11dGF0aW9uKG11dGF0aW9uKVxuXG4gICAgbGV0IHJlc3BvbnNlXG5cbiAgICB0cnkge1xuICAgICAgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLndpdGhGcm9udGVuZE1vZGVsUGFyYW1zKGNvbW1hbmRQYXJhbXMsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChjb21tYW5kUGFyYW1zLCB0aGlzLnJlc3BvbnNlKCksIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAoW1wiY3JlYXRlXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXS5pbmNsdWRlcyhtdXRhdGlvbi5vcGVyYXRpb24pKSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tbWFuZFBheWxvYWQoLyoqIEB0eXBlIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSAqLyAobXV0YXRpb24ub3BlcmF0aW9uKSkgfHwgdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQWN0aW9uIGhhbHRlZCBieSBiZWZvcmVBY3Rpb24uXCIpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q3VzdG9tQ29tbWFuZFBheWxvYWQoe211dGF0aW9uLCByZXBsYXlDb21tYW5kfSkgfHwgdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQWN0aW9uIGhhbHRlZCBieSBiZWZvcmVBY3Rpb24uXCIpXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSB0aGlzLmZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCh7XG4gICAgICAgIGFjdGlvbjogXCJmcm9udGVuZFN5bmNSZXBsYXlcIixcbiAgICAgICAgY29tbWFuZFR5cGU6IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZXBsYXlDb21tYW5kLmNvbW1hbmRUeXBlKSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIG1vZGVsOiBtdXRhdGlvbi5tb2RlbFxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHJlc3BvbnNlOiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSxcbiAgICAgICAgc2VydmVyU2VxdWVuY2U6IG51bGxcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2VydmVyU2VxdWVuY2UgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY0FwcGVuZFNlcnZlckNoYW5nZSh7XG4gICAgICAgIGlkZW1wb3RlbmN5S2V5OiBtdXRhdGlvbklkZW1wb3RlbmN5S2V5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbikpLFxuICAgICAgICBtdXRhdGlvbixcbiAgICAgICAgb2ZmbGluZUdyYW50LFxuICAgICAgICByZXNwb25zZVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHtyZXNwb25zZSwgc2VydmVyU2VxdWVuY2V9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgYWN0aW9uOiBcImZyb250ZW5kU3luY1JlcGxheVwiLFxuICAgICAgICBjb21tYW5kVHlwZTogLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlcGxheUNvbW1hbmQuY29tbWFuZFR5cGUpLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbW9kZWw6IG11dGF0aW9uLm1vZGVsXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgIHNlcnZlckNoYW5nZUZlZWRFcnJvcjogYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dCksXG4gICAgICAgIHNlcnZlckNoYW5nZUZlZWRTdGF0dXM6IFwiZXJyb3JcIixcbiAgICAgICAgc2VydmVyU2VxdWVuY2U6IG51bGxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHNpZ25lZCBvZmZsaW5lIGdyYW50IGNhcnJpZWQgYnkgYSByZXBsYXkgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2lnbmVkTXV0YXRpb24gLSBTaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTaWduZWQgb2ZmbGluZSBncmFudCBlbnZlbG9wZS5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVNpZ25lZE9mZmxpbmVHcmFudChzaWduZWRNdXRhdGlvbikge1xuICAgIGlmICghc2lnbmVkTXV0YXRpb24gfHwgdHlwZW9mIHNpZ25lZE11dGF0aW9uICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2lnbmVkTXV0YXRpb24pKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJFeHBlY3RlZCBzeW5jIHJlcGxheSBzaWduZWQgb2ZmbGluZSBncmFudFwiKVxuICAgIH1cblxuICAgIGNvbnN0IHNpZ25lZE11dGF0aW9uUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzaWduZWRNdXRhdGlvbilcbiAgICBjb25zdCBzaWduZWRPZmZsaW5lR3JhbnQgPSBzaWduZWRNdXRhdGlvblJlY29yZC5zaWduZWRPZmZsaW5lR3JhbnQgfHwgc2lnbmVkTXV0YXRpb25SZWNvcmQub2ZmbGluZUdyYW50IHx8IHNpZ25lZE11dGF0aW9uUmVjb3JkLnNpZ25lZEdyYW50XG5cbiAgICBpZiAoIXNpZ25lZE9mZmxpbmVHcmFudCkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwiRXhwZWN0ZWQgc3luYyByZXBsYXkgc2lnbmVkIG9mZmxpbmUgZ3JhbnRcIilcblxuICAgIHJldHVybiBzaWduZWRPZmZsaW5lR3JhbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyBhIHN5bmMgcmVwbGF5IHNpZ25lZCBvZmZsaW5lIGdyYW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zaWduZWRPZmZsaW5lR3JhbnQgLSBTaWduZWQgb2ZmbGluZSBncmFudCBlbnZlbG9wZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnRTaWduaW5nS2V5W119IGFyZ3Muc2lnbmluZ0tleXMgLSBBdmFpbGFibGUgc2lnbmluZyBrZXlzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnQ+fSAtIFZlcmlmaWVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNSZXBsYXlWZXJpZmllZE9mZmxpbmVHcmFudCh7c2lnbmVkT2ZmbGluZUdyYW50LCBzaWduaW5nS2V5c30pIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHZlcmlmeU9mZmxpbmVHcmFudCh7XG4gICAgICAgIG5vdzogbmV3IERhdGUoKSxcbiAgICAgICAgc2lnbmVkR3JhbnQ6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50fSAqLyAoc2lnbmVkT2ZmbGluZUdyYW50KSxcbiAgICAgICAgc2lnbmluZ0tleXNcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksIGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhhdCBhIHZlcmlmaWVkIG9mZmxpbmUgZ3JhbnQgYXV0aG9yaXplcyBhIHJlcGxheWVkIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudH0gYXJncy5vZmZsaW5lR3JhbnQgLSBWZXJpZmllZCBncmFudC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muc3luY1Jlc291cmNlIC0gQ3VycmVudCBzeW5jIHJlc291cmNlIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBUaHJvd3Mgd2hlbiB1bmF1dGhvcml6ZWQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNSZXBsYXlWYWxpZGF0ZU9mZmxpbmVHcmFudCh7bXV0YXRpb24sIG9mZmxpbmVHcmFudCwgc3luY1Jlc291cmNlfSkge1xuICAgIGlmIChvZmZsaW5lR3JhbnQuZ3JhbnRJZCAhPT0gbXV0YXRpb24ub2ZmbGluZUdyYW50SWQpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIlN5bmMgcmVwbGF5IG9mZmxpbmUgZ3JhbnQgZG9lcyBub3QgbWF0Y2ggbXV0YXRpb25cIilcbiAgICB9XG4gICAgaWYgKG9mZmxpbmVHcmFudC5kZXZpY2VJZCAhPT0gbXV0YXRpb24uYWN0b3JEZXZpY2VJZCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwiU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkZXZpY2UgZG9lcyBub3QgbWF0Y2ggbXV0YXRpb25cIilcbiAgICB9XG4gICAgaWYgKG9mZmxpbmVHcmFudC51c2VySWQgIT09IG11dGF0aW9uLmFjdG9yVXNlcklkKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHVzZXIgZG9lcyBub3QgbWF0Y2ggbXV0YXRpb25cIilcbiAgICB9XG5cbiAgICBjb25zdCBncmFudFJlc291cmNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovIChvZmZsaW5lR3JhbnQucmVzb3VyY2VzW211dGF0aW9uLm1vZGVsXSlcbiAgICBjb25zdCBncmFudE9wZXJhdGlvbnMgPSBBcnJheS5pc0FycmF5KGdyYW50UmVzb3VyY2U/Lm9wZXJhdGlvbnMpID8gZ3JhbnRSZXNvdXJjZS5vcGVyYXRpb25zIDogW11cbiAgICBjb25zdCBncmFudFBvbGljeUhhc2ggPSBncmFudFJlc291cmNlPy5wb2xpY3lIYXNoXG5cbiAgICBpZiAoIWdyYW50UmVzb3VyY2UgfHwgZ3JhbnRSZXNvdXJjZS5lbmFibGVkICE9PSB0cnVlKSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IG9mZmxpbmUgZ3JhbnQgZG9lcyBub3QgYXV0aG9yaXplICR7bXV0YXRpb24ubW9kZWx9YClcbiAgICBpZiAoIWdyYW50T3BlcmF0aW9ucy5pbmNsdWRlcyhtdXRhdGlvbi5vcGVyYXRpb24pKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IG9mZmxpbmUgZ3JhbnQgZG9lcyBub3QgYXV0aG9yaXplICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cbiAgICBpZiAoZ3JhbnRQb2xpY3lIYXNoICE9PSBtdXRhdGlvbi5wb2xpY3lIYXNoIHx8IGdyYW50UG9saWN5SGFzaCAhPT0gc3luY1Jlc291cmNlLnBvbGljeUhhc2gpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBwb2xpY3kgaGFzaCBtaXNtYXRjaCBmb3IgJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIH1cbiAgICBpZiAoIW9mZmxpbmVHcmFudC5zY29wZXMgfHwgdHlwZW9mIG9mZmxpbmVHcmFudC5zY29wZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvZmZsaW5lR3JhbnQuc2NvcGVzKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwiU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBzY29wZXMgYXJlIGludmFsaWRcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5cyBhIHZlcmlmaWVkIGN1c3RvbSBzeW5jIG11dGF0aW9uIHRocm91Z2ggdGhlIHJlc291cmNlIGNvbW1hbmQgQVBJLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge3tjb21tYW5kVHlwZTogc3RyaW5nLCBtZXRob2ROYW1lPzogc3RyaW5nLCBzY29wZT86IFwiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn19IGFyZ3MucmVwbGF5Q29tbWFuZCAtIFJlc29sdmVkIHJlcGxheSBjb21tYW5kIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIENvbW1hbmQgcmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheUN1c3RvbUNvbW1hbmRQYXlsb2FkKHttdXRhdGlvbiwgcmVwbGF5Q29tbWFuZH0pIHtcbiAgICBpZiAodHlwZW9mIHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCByZXBsYXlDb21tYW5kLm1ldGhvZE5hbWUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBjb21tYW5kIGlzIG5vdCByZWdpc3RlcmVkIGZvciAke211dGF0aW9uLm1vZGVsfTogJHttdXRhdGlvbi5vcGVyYXRpb259YClcbiAgICB9XG5cbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgICAgLm1hcCgoYmFja2VuZFByb2plY3QpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxOYW1lOiBtdXRhdGlvbi5tb2RlbH0pKVxuICAgICAgLmZpbmQoKHJlc291cmNlQ29uZmlndXJhdGlvbikgPT4gcmVzb3VyY2VDb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgbW9kZWwgaXMgbm90IGVuYWJsZWQ6ICR7bXV0YXRpb24ubW9kZWx9YClcblxuICAgIGNvbnN0IHJlc291cmNlID0gbmV3IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNsYXNzKHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuY3VycmVudEFiaWxpdHkoKSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMsXG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIC4uLih0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldENvbnRleHQoKSB8fCB7fSksXG4gICAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpXG4gICAgICB9LFxuICAgICAgbG9jYWxzOiB0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldExvY2FscygpIHx8IHt9LFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKGZyb250ZW5kTW9kZWxSZXNvdXJjZSksXG4gICAgICBtb2RlbE5hbWU6IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5tb2RlbE5hbWUsXG4gICAgICBwYXJhbXM6IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfSlcbiAgICBjb25zdCBjb21tYW5kID0gcmVzb3VyY2UucmVzb3VyY2VNZXRob2QocmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lKVxuXG4gICAgaWYgKCFjb21tYW5kKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGBNaXNzaW5nIGZyb250ZW5kLW1vZGVsIGN1c3RvbSBjb21tYW5kICcke3JlcGxheUNvbW1hbmQubWV0aG9kTmFtZX0nLmApXG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZEFyZ3VtZW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobXV0YXRpb24ucGF5bG9hZCAmJiB0eXBlb2YgbXV0YXRpb24ucGF5bG9hZCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShtdXRhdGlvbi5wYXlsb2FkKSA/IG11dGF0aW9uLnBheWxvYWQgOiB7fSlcbiAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBhd2FpdCBjb21tYW5kLm1ldGhvZC5jYWxsKGNvbW1hbmQucmVzb3VyY2UsIGNvbW1hbmRBcmd1bWVudHMpXG5cbiAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCB8fCB0eXBlb2YgcmVzcG9uc2VQYXlsb2FkICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4ge3N0YXR1czogXCJzdWNjZXNzXCJ9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoXG4gICAgICBhd2FpdCB0aGlzLmF1dG9TZXJpYWxpemVGcm9udGVuZE1vZGVsc0luUGF5bG9hZChcbiAgICAgICAgcmVzcG9uc2VQYXlsb2FkLFxuICAgICAgICAvKiogQHR5cGUge3tzZXJpYWxpemU6IChtb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFjdGlvbjogc3RyaW5nKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59fSAqLyAoY29tbWFuZC5yZXNvdXJjZSksXG4gICAgICAgIHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZVxuICAgICAgKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgZnJvbnRlbmQtbW9kZWwgY29tbWFuZCBwYXJhbXMgZm9yIGEgdmVyaWZpZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBtdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIEZyb250ZW5kLW1vZGVsIGNvbW1hbmQgcGFyYW1zLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZFBhcmFtcyhtdXRhdGlvbikge1xuICAgIGNvbnN0IHBheWxvYWQgPSBtdXRhdGlvbi5wYXlsb2FkICYmIHR5cGVvZiBtdXRhdGlvbi5wYXlsb2FkID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KG11dGF0aW9uLnBheWxvYWQpID8gbXV0YXRpb24ucGF5bG9hZCA6IHt9XG4gICAgY29uc3Qge2F0dHJpYnV0ZXMsIHByaW1hcnlLZXlWYWx1ZX0gPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRBdHRyaWJ1dGVzKG11dGF0aW9uKVxuICAgIGNvbnN0IGNvbW1hbmRQYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHtcbiAgICAgIC4uLnBheWxvYWQsXG4gICAgICBhdHRyaWJ1dGVzLFxuICAgICAgbW9kZWw6IG11dGF0aW9uLm1vZGVsXG4gICAgfSlcblxuICAgIGlmIChbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgIGlmIChtdXRhdGlvbi5vcGVyYXRpb24gIT09IFwiY3JlYXRlXCIpIHtcbiAgICAgICAgY29uc3QgaWQgPSBjb21tYW5kUGFyYW1zLmlkIHx8IGNvbW1hbmRQYXJhbXMucmVjb3JkSWQgfHwgcHJpbWFyeUtleVZhbHVlXG5cbiAgICAgICAgaWYgKHR5cGVvZiBpZCAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgaWQgIT09IFwibnVtYmVyXCIpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgJHttdXRhdGlvbi5vcGVyYXRpb259IHJlcXVpcmVzIGFuIGlkYClcblxuICAgICAgICBjb21tYW5kUGFyYW1zLmlkID0gaWRcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvbW1hbmRQYXJhbXNcbiAgICB9XG5cbiAgICBjb25zdCByZXBsYXlDb21tYW5kID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kRm9yTXV0YXRpb24obXV0YXRpb24pXG5cbiAgICBjb21tYW5kUGFyYW1zLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kTWV0aG9kTmFtZSA9IHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZVxuICAgIGNvbW1hbmRQYXJhbXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRTY29wZSA9IHJlcGxheUNvbW1hbmQuc2NvcGVcblxuICAgIGlmIChyZXBsYXlDb21tYW5kLnNjb3BlID09PSBcIm1lbWJlclwiKSB7XG4gICAgICBjb25zdCBpZCA9IGNvbW1hbmRQYXJhbXMuaWQgfHwgY29tbWFuZFBhcmFtcy5yZWNvcmRJZCB8fCBwcmltYXJ5S2V5VmFsdWVcblxuICAgICAgaWYgKHR5cGVvZiBpZCAhPT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgaWQgIT09IFwibnVtYmVyXCIpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgJHttdXRhdGlvbi5vcGVyYXRpb259IHJlcXVpcmVzIGFuIGlkYClcblxuICAgICAgY29tbWFuZFBhcmFtcy5pZCA9IGlkXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbW1hbmRQYXJhbXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZnJvbnRlbmQtbW9kZWwgY29tbWFuZCB1c2VkIGZvciBhIHZlcmlmaWVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBWZXJpZmllZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3tjb21tYW5kVHlwZTogc3RyaW5nLCBtZXRob2ROYW1lPzogc3RyaW5nLCBzY29wZT86IFwiY29sbGVjdGlvblwiIHwgXCJtZW1iZXJcIn19IC0gQ29tbWFuZCBtZXRhZGF0YS5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRGb3JNdXRhdGlvbihtdXRhdGlvbikge1xuICAgIGlmIChbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgIHJldHVybiB7Y29tbWFuZFR5cGU6IG11dGF0aW9uLm9wZXJhdGlvbn1cbiAgICB9XG5cbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgICAgLm1hcCgoYmFja2VuZFByb2plY3QpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxOYW1lOiBtdXRhdGlvbi5tb2RlbH0pKVxuICAgICAgLmZpbmQoKHJlc291cmNlQ29uZmlndXJhdGlvbikgPT4gcmVzb3VyY2VDb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgbW9kZWwgaXMgbm90IGVuYWJsZWQ6ICR7bXV0YXRpb24ubW9kZWx9YClcblxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gdHlwZW9mIG11dGF0aW9uLmNvbW1hbmQgPT09IFwic3RyaW5nXCIgJiYgbXV0YXRpb24uY29tbWFuZC5sZW5ndGggPiAwID8gbXV0YXRpb24uY29tbWFuZCA6IG11dGF0aW9uLm9wZXJhdGlvblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocmVzb3VyY2VDb25maWd1cmF0aW9uLmNvbGxlY3Rpb25Db21tYW5kcywgY29tbWFuZE5hbWUpKSB7XG4gICAgICByZXR1cm4ge2NvbW1hbmRUeXBlOiBjb21tYW5kTmFtZSwgbWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHNjb3BlOiBcImNvbGxlY3Rpb25cIn1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJlc291cmNlQ29uZmlndXJhdGlvbi5tZW1iZXJDb21tYW5kcywgY29tbWFuZE5hbWUpKSB7XG4gICAgICByZXR1cm4ge2NvbW1hbmRUeXBlOiBjb21tYW5kTmFtZSwgbWV0aG9kTmFtZTogY29tbWFuZE5hbWUsIHNjb3BlOiBcIm1lbWJlclwifVxuICAgIH1cblxuICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgY29tbWFuZCBpcyBub3QgcmVnaXN0ZXJlZCBmb3IgJHttdXRhdGlvbi5tb2RlbH06ICR7Y29tbWFuZE5hbWV9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjb21tYW5kIGF0dHJpYnV0ZXMgYW5kIHByaW1hcnkga2V5IGZyb20gYSByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IG11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHByaW1hcnlLZXlWYWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgdW5kZWZpbmVkfT59IC0gQ29tbWFuZCBhdHRyaWJ1dGVzIGFuZCBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRBdHRyaWJ1dGVzKG11dGF0aW9uKSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoey4uLihtdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9KX0pXG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKClcbiAgICAgIC5tYXAoKGJhY2tlbmRQcm9qZWN0KSA9PiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JCYWNrZW5kUHJvamVjdE1vZGVsTmFtZSh7YmFja2VuZFByb2plY3QsIG1vZGVsTmFtZTogbXV0YXRpb24ubW9kZWx9KSlcbiAgICAgIC5maW5kKChyZXNvdXJjZUNvbmZpZ3VyYXRpb24pID0+IHJlc291cmNlQ29uZmlndXJhdGlvbilcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSByZXR1cm4ge2F0dHJpYnV0ZXMsIHByaW1hcnlLZXlWYWx1ZTogdW5kZWZpbmVkfVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHR5cGVvZiBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkgPT09IFwic3RyaW5nXCIgPyBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uLnByaW1hcnlLZXkgOiBcImlkXCJcbiAgICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlID0gYXR0cmlidXRlc1twcmltYXJ5S2V5XVxuICAgIGNvbnN0IHByaW1hcnlLZXlWYWx1ZSA9IHR5cGVvZiBwcmltYXJ5S2V5QXR0cmlidXRlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBwcmltYXJ5S2V5QXR0cmlidXRlID09PSBcIm51bWJlclwiID8gcHJpbWFyeUtleUF0dHJpYnV0ZSA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKHByaW1hcnlLZXlWYWx1ZSAhPT0gdW5kZWZpbmVkICYmIG11dGF0aW9uLm9wZXJhdGlvbiAhPT0gXCJjcmVhdGVcIikgZGVsZXRlIGF0dHJpYnV0ZXNbcHJpbWFyeUtleV1cblxuICAgIHJldHVybiB7YXR0cmlidXRlcywgcHJpbWFyeUtleVZhbHVlfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGVuZHMgYSBzdWNjZXNzZnVsbHkgcmVwbGF5ZWQgbXV0YXRpb24gdG8gdGhlIHNlcnZlciBjaGFuZ2UgZmVlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVsbH0gYXJncy5pZGVtcG90ZW5jeUtleSAtIE11dGF0aW9uIGlkZW1wb3RlbmN5IGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudH0gYXJncy5vZmZsaW5lR3JhbnQgLSBWZXJpZmllZCBvZmZsaW5lIGdyYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5yZXNwb25zZSAtIFJlcGxheSBjb21tYW5kIHJlc3BvbnNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBudWxsPn0gLSBBc3NpZ25lZCBzZXJ2ZXIgc2VxdWVuY2UsIG9yIG51bGwgd2hlbiBubyBjaGFuZ2Ugd2FzIGFwcGVuZGVkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jQXBwZW5kU2VydmVyQ2hhbmdlKHtpZGVtcG90ZW5jeUtleSwgbXV0YXRpb24sIG9mZmxpbmVHcmFudCwgcmVzcG9uc2V9KSB7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyAhPT0gXCJzdWNjZXNzXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzdG9yZSA9IHNlcnZlckNoYW5nZUZlZWRTdG9yZUZvckNvbmZpZ3VyYXRpb24odGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgY29uc3QgcmVzcG9uc2VTeW5jQ2hhbmdlcyA9IEFycmF5LmlzQXJyYXkocmVzcG9uc2Uuc3luY0NoYW5nZXMpID8gcmVzcG9uc2Uuc3luY0NoYW5nZXMgOiBbXVxuICAgIGNvbnN0IHN5bmNDaGFuZ2VzID0gcmVzcG9uc2VTeW5jQ2hhbmdlcy5sZW5ndGggPiAwID8gcmVzcG9uc2VTeW5jQ2hhbmdlcyA6IFt7XG4gICAgICBhdHRyaWJ1dGVzOiBtdXRhdGlvbi5hdHRyaWJ1dGVzLFxuICAgICAgbW9kZWw6IG11dGF0aW9uLm1vZGVsLFxuICAgICAgb3BlcmF0aW9uOiBtdXRhdGlvbi5vcGVyYXRpb24sXG4gICAgICBwYXlsb2FkOiBtdXRhdGlvbi5wYXlsb2FkXG4gICAgfV1cbiAgICBsZXQgc2VydmVyU2VxdWVuY2UgPSAvKiogQHR5cGUge251bWJlciB8IG51bGx9ICovIChudWxsKVxuXG4gICAgZm9yIChjb25zdCBzeW5jQ2hhbmdlIG9mIHN5bmNDaGFuZ2VzKSB7XG4gICAgICBpZiAoIXN5bmNDaGFuZ2UgfHwgdHlwZW9mIHN5bmNDaGFuZ2UgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzeW5jQ2hhbmdlKSkgY29udGludWVcblxuICAgICAgY29uc3QgY2hhbmdlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzeW5jQ2hhbmdlKVxuICAgICAgY29uc3QgcGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2hhbmdlLnBheWxvYWQgJiYgdHlwZW9mIGNoYW5nZS5wYXlsb2FkID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGNoYW5nZS5wYXlsb2FkKSA/IGNoYW5nZS5wYXlsb2FkIDoge30pXG4gICAgICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjaGFuZ2UuYXR0cmlidXRlcyAmJiB0eXBlb2YgY2hhbmdlLmF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoY2hhbmdlLmF0dHJpYnV0ZXMpID8gY2hhbmdlLmF0dHJpYnV0ZXMgOiB7fSlcbiAgICAgIGNvbnN0IG1vZGVsID0gdHlwZW9mIGNoYW5nZS5tb2RlbCA9PT0gXCJzdHJpbmdcIiAmJiBjaGFuZ2UubW9kZWwubGVuZ3RoID4gMCA/IGNoYW5nZS5tb2RlbCA6IG11dGF0aW9uLm1vZGVsXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSB0eXBlb2YgY2hhbmdlLm9wZXJhdGlvbiA9PT0gXCJzdHJpbmdcIiAmJiBjaGFuZ2Uub3BlcmF0aW9uLmxlbmd0aCA+IDAgPyBjaGFuZ2Uub3BlcmF0aW9uIDogbXV0YXRpb24ub3BlcmF0aW9uXG4gICAgICBjb25zdCByYXdSZWNvcmRJZCA9IGNoYW5nZS5yZWNvcmRJZCA/PyBwYXlsb2FkLmlkID8/IHBheWxvYWQucmVjb3JkSWQgPz8gYXR0cmlidXRlcy5pZCA/PyBudWxsXG4gICAgICBjb25zdCByZWNvcmRJZCA9IHJhd1JlY29yZElkID09PSBudWxsIHx8IHJhd1JlY29yZElkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHJhd1JlY29yZElkKVxuICAgICAgY29uc3QgYXBwZW5kZWRDaGFuZ2UgPSBhd2FpdCBzdG9yZS5hcHBlbmQoe1xuICAgICAgICBhY3RvckRldmljZUlkOiBtdXRhdGlvbi5hY3RvckRldmljZUlkLFxuICAgICAgICBhY3RvclVzZXJJZDogbXV0YXRpb24uYWN0b3JVc2VySWQsXG4gICAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICAgIGlkZW1wb3RlbmN5S2V5LFxuICAgICAgICBtb2RlbCxcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICBwYXlsb2FkLFxuICAgICAgICByZWNvcmRJZCxcbiAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgIHNjb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzXG4gICAgICB9KVxuXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZSA9IGFwcGVuZGVkQ2hhbmdlLnNlcnZlclNlcXVlbmNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHNlcnZlclNlcXVlbmNlXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgdGhlIHNpZ25lZCBvZmZsaW5lIGdyYW50IHVzZWQgdG8gc2NvcGUgc3luYyByZWFkIGVuZHBvaW50cy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnQ+fSAtIFZlcmlmaWVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNSZXF1ZXN0VmVyaWZpZWRPZmZsaW5lR3JhbnQocGFyYW1zKSB7XG4gICAgY29uc3Qgc2lnbmVkT2ZmbGluZUdyYW50ID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlTaWduZWRPZmZsaW5lR3JhbnQocGFyYW1zKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5VmVyaWZpZWRPZmZsaW5lR3JhbnQoe1xuICAgICAgc2lnbmVkT2ZmbGluZUdyYW50LFxuICAgICAgc2lnbmluZ0tleXM6IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50U2lnbmluZ0tleXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgc3luYyBjaGFuZ2UgZmVlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3luYyBjaGFuZ2UtZmVlZCByZXNwb25zZS5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY0NoYW5nZUZlZWQoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCBvZmZsaW5lR3JhbnQgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcXVlc3RWZXJpZmllZE9mZmxpbmVHcmFudChwYXJhbXMpXG4gICAgY29uc3QgYWZ0ZXJTZXF1ZW5jZSA9IHRoaXMuZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZEFmdGVyU2VxdWVuY2UocGFyYW1zKVxuICAgIGNvbnN0IHN0b3JlID0gc2VydmVyQ2hhbmdlRmVlZFN0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICBjb25zdCBsaW1pdCA9IHRoaXMuZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZExpbWl0KHBhcmFtcylcbiAgICBjb25zdCBjdXJyZW50U2VydmVyU2VxdWVuY2UgPSBhd2FpdCBzdG9yZS5sYXRlc3RTZXF1ZW5jZSgpXG4gICAgY29uc3Qgc2VydmVyU2VxdWVuY2UgPSB0aGlzLmZyb250ZW5kU3luY0NoYW5nZUZlZWRVcFRvU2VxdWVuY2UocGFyYW1zLCBjdXJyZW50U2VydmVyU2VxdWVuY2UpXG4gICAgY29uc3QgcGFnZSA9IGF3YWl0IHN0b3JlLmNoYW5nZXNBZnRlcih7YWZ0ZXJTZXF1ZW5jZSwgbGltaXQsIHNjb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzLCB1cFRvU2VxdWVuY2U6IHNlcnZlclNlcXVlbmNlfSlcblxuICAgIGlmIChwYWdlLnNuYXBzaG90UmVxdWlyZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoe1xuICAgICAgICAgIGNoYW5nZXM6IFtdLFxuICAgICAgICAgIG9sZGVzdFNlcXVlbmNlOiBwYWdlLm9sZGVzdFNlcXVlbmNlLFxuICAgICAgICAgIHJlcXVlc3RlZEFmdGVyU2VxdWVuY2U6IGFmdGVyU2VxdWVuY2UsXG4gICAgICAgICAgc2VydmVyU2VxdWVuY2UsXG4gICAgICAgICAgc25hcHNob3Q6IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jU25hcHNob3RQYXlsb2FkKHtzY29wZTogb2ZmbGluZUdyYW50LnNjb3Blcywgc2VydmVyU2VxdWVuY2V9KSxcbiAgICAgICAgICBzdGF0dXM6IFwic25hcHNob3RfcmVxdWlyZWRcIlxuICAgICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNoYW5nZXMgPSBwYWdlLmNoYW5nZXNcbiAgICBjb25zdCBpbmNsdWRlU25hcHNob3QgPSBwYXJhbXMuc25hcHNob3QgPT09IHRydWUgfHwgcGFyYW1zLmluY2x1ZGVTbmFwc2hvdCA9PT0gdHJ1ZSB8fCBhZnRlclNlcXVlbmNlID09PSAwXG4gICAgY29uc3Qgc25hcHNob3QgPSBpbmNsdWRlU25hcHNob3QgPyBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1NuYXBzaG90UGF5bG9hZCh7c2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXMsIHNlcnZlclNlcXVlbmNlfSkgOiB1bmRlZmluZWRcblxuICAgIGNvbnN0IHBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHtcbiAgICAgIGNoYW5nZXMsXG4gICAgICBoYXNNb3JlOiBwYWdlLmhhc01vcmUsXG4gICAgICBuZXh0U2VxdWVuY2U6IHBhZ2UubmV4dFNlcXVlbmNlLFxuICAgICAgc2VydmVyU2VxdWVuY2UsXG4gICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiLFxuICAgICAgdXBUb1NlcXVlbmNlOiBwYWdlLnVwVG9TZXF1ZW5jZVxuICAgIH0pXG5cbiAgICBpZiAoc25hcHNob3QpIHBheWxvYWQuc25hcHNob3QgPSBzbmFwc2hvdFxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocGF5bG9hZCwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgY2hhbmdlLWZlZWQgY3Vyc29yLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRXhjbHVzaXZlIGxvd2VyLWJvdW5kIHNlcXVlbmNlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZEFmdGVyU2VxdWVuY2UocGFyYW1zKSB7XG4gICAgY29uc3QgYWZ0ZXJTZXF1ZW5jZSA9IHBhcmFtcy5hZnRlclNlcXVlbmNlID8/IHBhcmFtcy5jdXJzb3IgPz8gMFxuXG4gICAgaWYgKHR5cGVvZiBhZnRlclNlcXVlbmNlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIoYWZ0ZXJTZXF1ZW5jZSkgJiYgYWZ0ZXJTZXF1ZW5jZSA+PSAwKSByZXR1cm4gYWZ0ZXJTZXF1ZW5jZVxuICAgIGlmICh0eXBlb2YgYWZ0ZXJTZXF1ZW5jZSA9PT0gXCJzdHJpbmdcIiAmJiAvXlxcZCskLy50ZXN0KGFmdGVyU2VxdWVuY2UpKSByZXR1cm4gTnVtYmVyKGFmdGVyU2VxdWVuY2UpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGNoYW5nZS1mZWVkIGFmdGVyU2VxdWVuY2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzeW5jIGNoYW5nZS1mZWVkIHBhZ2UgbGltaXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBQYWdlIGxpbWl0LlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZExpbWl0KHBhcmFtcykge1xuICAgIGNvbnN0IGxpbWl0ID0gcGFyYW1zLmxpbWl0ID8/IHBhcmFtcy5wYWdlU2l6ZSA/PyAxMDBcblxuICAgIGlmICh0eXBlb2YgbGltaXQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcihsaW1pdCkgJiYgbGltaXQgPiAwKSByZXR1cm4gbGltaXRcbiAgICBpZiAodHlwZW9mIGxpbWl0ID09PSBcInN0cmluZ1wiICYmIC9eXFxkKyQvLnRlc3QobGltaXQpKSByZXR1cm4gTnVtYmVyKGxpbWl0KVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBjaGFuZ2UtZmVlZCBwb3NpdGl2ZSBsaW1pdFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgY2hhbmdlLWZlZWQgc3RhYmxlIGhpZ2gtd2F0ZXIgbWFyay5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gY3VycmVudFNlcnZlclNlcXVlbmNlIC0gQ3VycmVudCBsYXRlc3Qgc2VydmVyIHNlcXVlbmNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEluY2x1c2l2ZSB1cHBlci1ib3VuZCBzZXF1ZW5jZS5cbiAgICovXG4gIGZyb250ZW5kU3luY0NoYW5nZUZlZWRVcFRvU2VxdWVuY2UocGFyYW1zLCBjdXJyZW50U2VydmVyU2VxdWVuY2UpIHtcbiAgICBjb25zdCB1cFRvU2VxdWVuY2UgPSBwYXJhbXMudXBUb1NlcXVlbmNlID8/IHBhcmFtcy5zZXJ2ZXJTZXF1ZW5jZSA/PyBjdXJyZW50U2VydmVyU2VxdWVuY2VcblxuICAgIGlmICh0eXBlb2YgdXBUb1NlcXVlbmNlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIodXBUb1NlcXVlbmNlKSAmJiB1cFRvU2VxdWVuY2UgPj0gMCkgcmV0dXJuIE1hdGgubWluKHVwVG9TZXF1ZW5jZSwgY3VycmVudFNlcnZlclNlcXVlbmNlKVxuICAgIGlmICh0eXBlb2YgdXBUb1NlcXVlbmNlID09PSBcInN0cmluZ1wiICYmIC9eXFxkKyQvLnRlc3QodXBUb1NlcXVlbmNlKSkgcmV0dXJuIE1hdGgubWluKE51bWJlcih1cFRvU2VxdWVuY2UpLCBjdXJyZW50U2VydmVyU2VxdWVuY2UpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGNoYW5nZS1mZWVkIHVwVG9TZXF1ZW5jZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgc3luYyBzbmFwc2hvdCBlbmRwb2ludC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU3luYyBzbmFwc2hvdCByZXNwb25zZS5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1NuYXBzaG90KCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXF1ZXN0VmVyaWZpZWRPZmZsaW5lR3JhbnQocGFyYW1zKVxuICAgIGNvbnN0IHN0b3JlID0gc2VydmVyQ2hhbmdlRmVlZFN0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZSA9IGF3YWl0IHN0b3JlLmxhdGVzdFNlcXVlbmNlKClcbiAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jU25hcHNob3RQYXlsb2FkKHtzY29wZTogb2ZmbGluZUdyYW50LnNjb3Blcywgc2VydmVyU2VxdWVuY2V9KVxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoe1xuICAgICAgICBzbmFwc2hvdCxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgfSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHNuYXBzaG90IG9mIHN5bmMtZW5hYmxlZCBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMgYXQgYSBzdGFibGUgc2VydmVyIHNlcXVlbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3Muc2VydmVyU2VxdWVuY2UgLSBTbmFwc2hvdCBzZXF1ZW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLnNjb3BlXSAtIENhbGxlciBzeW5jIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7cmVzb3VyY2VzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNlcnZlclNlcXVlbmNlOiBudW1iZXJ9Pn0gLSBTbmFwc2hvdCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jU25hcHNob3RQYXlsb2FkKHtzY29wZSwgc2VydmVyU2VxdWVuY2V9KSB7XG4gICAgY29uc3Qgc3luY01hbmlmZXN0ID0gZnJvbnRlbmRNb2RlbFN5bmNNYW5pZmVzdEZvckJhY2tlbmRQcm9qZWN0cyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKSlcbiAgICBjb25zdCByZXNvdXJjZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHt9KVxuXG4gICAgZm9yIChjb25zdCBtb2RlbE5hbWUgb2YgT2JqZWN0LmtleXMoc3luY01hbmlmZXN0KS5zb3J0KCkpIHtcbiAgICAgIGNvbnN0IGNvbW1hbmRQYXJhbXMgPSB7Li4uKHNjb3BlIHx8IHt9KSwgbW9kZWw6IG1vZGVsTmFtZX1cblxuICAgICAgcmVzb3VyY2VzW21vZGVsTmFtZV0gPSBhd2FpdCB0aGlzLndpdGhGcm9udGVuZE1vZGVsUGFyYW1zKGNvbW1hbmRQYXJhbXMsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChjb21tYW5kUGFyYW1zLCB0aGlzLnJlc3BvbnNlKCksIGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tbWFuZFBheWxvYWQoXCJpbmRleFwiKSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHtyZXNvdXJjZXMsIHNlcnZlclNlcXVlbmNlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXBpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTaGFyZWQgZnJvbnRlbmQgbW9kZWwgQVBJIGFjdGlvbiB3aXRoIGJhdGNoIHN1cHBvcnQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEFwaSgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHRoaXMucGFyYW1zKCkpKVxuICAgIGNvbnN0IHJlcXVlc3RzID0gQXJyYXkuaXNBcnJheShwYXJhbXMucmVxdWVzdHMpID8gcGFyYW1zLnJlcXVlc3RzIDogW3BhcmFtc11cbiAgICAvKipcbiAgICAgKiBSZXNwb25zZXMuXG4gICAgICogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgcmVzcG9uc2VzID0gW11cblxuICAgIGZvciAoY29uc3QgcmVxdWVzdEVudHJ5IG9mIHJlcXVlc3RzKSB7XG4gICAgICBjb25zdCBjb21tYW5kVHlwZSA9IHJlcXVlc3RFbnRyeT8uY29tbWFuZFR5cGVcbiAgICAgIGNvbnN0IGN1c3RvbVBhdGggPSByZXF1ZXN0RW50cnk/LmN1c3RvbVBhdGhcbiAgICAgIGNvbnN0IG1vZGVsID0gcmVxdWVzdEVudHJ5Py5tb2RlbFxuICAgICAgY29uc3QgcGF5bG9hZCA9IHJlcXVlc3RFbnRyeT8ucGF5bG9hZFxuICAgICAgY29uc3QgcmVxdWVzdElkID0gcmVxdWVzdEVudHJ5Py5yZXF1ZXN0SWRcblxuICAgICAgaWYgKHR5cGVvZiBtb2RlbCAhPT0gXCJzdHJpbmdcIiB8fCBtb2RlbC5sZW5ndGggPCAxKSB7XG4gICAgICAgIHJlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVzcG9uc2U6IHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIHJlcXVlc3QgbW9kZWwuXCIpXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlzQnVpbHRJbkNvbW1hbmQgPSBbXCJpbmRleFwiLCBcImZpbmRcIiwgXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCIsIFwiYXR0YWNoXCIsIFwiZG93bmxvYWRcIiwgXCJ1cmxcIiwgXCJhdHRhY2htZW50TGlzdFwiXS5pbmNsdWRlcyhjb21tYW5kVHlwZSlcblxuICAgICAgaWYgKCFpc0J1aWx0SW5Db21tYW5kICYmICh0eXBlb2YgY3VzdG9tUGF0aCAhPT0gXCJzdHJpbmdcIiB8fCAhY3VzdG9tUGF0aC5zdGFydHNXaXRoKFwiL1wiKSkpIHtcbiAgICAgICAgcmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXNwb25zZTogdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgcmVxdWVzdCBjdXN0b21QYXRoLlwiKVxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXF1ZXN0Q29udGV4dCA9IGNhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQocmVxdWVzdEVudHJ5Py5yZXF1ZXN0Q29udGV4dClcbiAgICAgICAgbGV0IHJlc3BvbnNlUGF5bG9hZFxuXG4gICAgICAgIGlmIChpc0J1aWx0SW5Db21tYW5kKSB7XG4gICAgICAgICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KFxuICAgICAgICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIC4uLihwYXlsb2FkICYmIHR5cGVvZiBwYXlsb2FkID09PSBcIm9iamVjdFwiID8gcGF5bG9hZCA6IHt9KSxcbiAgICAgICAgICAgICAgbW9kZWxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApXG5cbiAgICAgICAgICByZXNwb25zZVBheWxvYWQgPSBhd2FpdCB0aGlzLndpdGhGcm9udGVuZE1vZGVsUGFyYW1zKGNvbW1hbmRQYXJhbXMsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhGcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoY29tbWFuZFBhcmFtcywgdGhpcy5yZXNwb25zZSgpLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZChjb21tYW5kVHlwZSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNwb25zZVBheWxvYWQgPSBhd2FpdCB0aGlzLmZyb250ZW5kQXBpQ3VzdG9tQ29tbWFuZFBheWxvYWQoe1xuICAgICAgICAgICAgY3VzdG9tUGF0aCxcbiAgICAgICAgICAgIHBheWxvYWQsXG4gICAgICAgICAgICByZXF1ZXN0Q29udGV4dFxuICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHJlc3BvbnNlOiByZXNwb25zZVBheWxvYWQgfHwgdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQWN0aW9uIGhhbHRlZCBieSBiZWZvcmVBY3Rpb24uXCIpXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBlcnJvckNvbnRleHQgPSB0aGlzLmZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCh7XG4gICAgICAgICAgYWN0aW9uOiBcImZyb250ZW5kQXBpXCIsXG4gICAgICAgICAgY29tbWFuZFR5cGUsXG4gICAgICAgICAgZXJyb3IsXG4gICAgICAgICAgbW9kZWwsXG4gICAgICAgICAgcmVxdWVzdElkXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgICAgcmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXNwb25zZTogYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dClcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIHJlc3BvbnNlcyxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgfSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIERpc3BhdGNoZXMgYSBjdXN0b20gZnJvbnRlbmQtbW9kZWwgY29tbWFuZCB0aHJvdWdoIHRoZSBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJIGVuZHBvaW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3VzdG9tUGF0aCAtIEN1c3RvbSBiYWNrZW5kIHJvdXRlIHBhdGguXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGF5bG9hZCAtIFJlcXVlc3QgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3JlbW90ZS1yZXF1ZXN0LWNvbnRleHQuanNcIikuUmVtb3RlUmVxdWVzdENvbnRleHR9IGFyZ3MucmVxdWVzdENvbnRleHQgLSBDYXB0dXJlZCByZW1vdGUgcmVxdWVzdCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFBhcnNlZCBKU09OIHJlc3BvbnNlIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEFwaUN1c3RvbUNvbW1hbmRQYXlsb2FkKHtjdXN0b21QYXRoLCBwYXlsb2FkLCByZXF1ZXN0Q29udGV4dH0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCByZXNwb25zZSA9IG5ldyBSZXNwb25zZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgY29uc3QgcmVzb2x2ZXIgPSBuZXcgUm91dGVzUmVzb2x2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIHJlcXVlc3Q6IHRoaXMuZ2V0UmVxdWVzdCgpLFxuICAgICAgcmVzcG9uc2VcbiAgICB9KVxuICAgIHJlc29sdmVyLnBhcmFtcyA9IHt9XG4gICAgY29uc3Qgcm91dGVIb29rTWF0Y2ggPSBhd2FpdCByZXNvbHZlci5yZXNvbHZlUm91dGVSZXNvbHZlckhvb2tzKGN1c3RvbVBhdGgpXG4gICAgY29uc3QgY29uZmlndXJhdGlvblJvdXRlcyA9IGNvbmZpZ3VyYXRpb24uZ2V0Um91dGVzKClcbiAgICBjb25zdCByb3V0ZU1hdGNoID0gcm91dGVIb29rTWF0Y2ggfHwgIWNvbmZpZ3VyYXRpb25Sb3V0ZXM/LnJvb3RSb3V0ZSA/IHVuZGVmaW5lZCA6IHJlc29sdmVyLm1hdGNoUGF0aFdpdGhSb3V0ZXMoY29uZmlndXJhdGlvblJvdXRlcy5yb290Um91dGUsIGN1c3RvbVBhdGgpXG5cbiAgICBpZiAoIXJvdXRlSG9va01hdGNoICYmICFyb3V0ZU1hdGNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGN1c3RvbSBmcm9udGVuZCBtb2RlbCByb3V0ZSBtYXRjaGVkICcke2N1c3RvbVBhdGh9J2ApXG4gICAgfVxuXG4gICAgY29uc3QgYWN0aW9uUGFyYW0gPSByb3V0ZUhvb2tNYXRjaD8uYWN0aW9uIHx8IHJlc29sdmVyLnBhcmFtcy5hY3Rpb25cbiAgICBjb25zdCBjb250cm9sbGVyUGFyYW0gPSByb3V0ZUhvb2tNYXRjaD8uY29udHJvbGxlciB8fCByZXNvbHZlci5wYXJhbXMuY29udHJvbGxlclxuICAgIGNvbnN0IGFjdGlvblZhbHVlID0gdHlwZW9mIGFjdGlvblBhcmFtID09PSBcInN0cmluZ1wiID8gYWN0aW9uUGFyYW0gOiAoQXJyYXkuaXNBcnJheShhY3Rpb25QYXJhbSkgPyBhY3Rpb25QYXJhbVswXSA6IHVuZGVmaW5lZClcbiAgICBjb25zdCBjb250cm9sbGVyVmFsdWUgPSB0eXBlb2YgY29udHJvbGxlclBhcmFtID09PSBcInN0cmluZ1wiID8gY29udHJvbGxlclBhcmFtIDogKEFycmF5LmlzQXJyYXkoY29udHJvbGxlclBhcmFtKSA/IGNvbnRyb2xsZXJQYXJhbVswXSA6IHVuZGVmaW5lZClcblxuICAgIGlmICh0eXBlb2YgYWN0aW9uVmFsdWUgIT09IFwic3RyaW5nXCIgfHwgYWN0aW9uVmFsdWUubGVuZ3RoIDwgMSB8fCB0eXBlb2YgY29udHJvbGxlclZhbHVlICE9PSBcInN0cmluZ1wiIHx8IGNvbnRyb2xsZXJWYWx1ZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEN1c3RvbSBmcm9udGVuZCBtb2RlbCByb3V0ZSBtYXRjaGVkICcke2N1c3RvbVBhdGh9JyB3aXRob3V0IGNvbnRyb2xsZXIvYWN0aW9uIHBhcmFtc2ApXG4gICAgfVxuXG4gICAgY29uc3QgYWN0aW9uID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShhY3Rpb25WYWx1ZS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikucmVwbGFjZUFsbChcIi9cIiwgXCJfXCIpLCB0cnVlKVxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBjb250cm9sbGVyVmFsdWVcbiAgICBjb25zdCBjb250cm9sbGVyUGF0aCA9IHJvdXRlSG9va01hdGNoPy5jb250cm9sbGVyUGF0aCB8fCBgJHtjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpfS9zcmMvcm91dGVzLyR7Y29udHJvbGxlcn0vY29udHJvbGxlci5qc2BcbiAgICBjb25zdCB2aWV3UGF0aCA9IHJvdXRlSG9va01hdGNoPy52aWV3UGF0aCB8fCBgJHtjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpfS9zcmMvcm91dGVzLyR7Y29udHJvbGxlcn1gXG4gICAgcmVzb2x2ZXIucm91dGVIb29rQ29udHJvbGxlckNsYXNzID0gcm91dGVIb29rTWF0Y2g/LmNvbnRyb2xsZXJDbGFzc1xuICAgIGNvbnN0IGNvbnRyb2xsZXJDbGFzcyA9IGF3YWl0IHJlc29sdmVyLnJlc29sdmVDb250cm9sbGVyQ2xhc3Moe2NvbnRyb2xsZXJQYXRofSlcbiAgICBjb25zdCBjb250cm9sbGVyUGFyYW1zID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgIHtcbiAgICAgICAgLi4uKChwYXlsb2FkICYmIHR5cGVvZiBwYXlsb2FkID09PSBcIm9iamVjdFwiKSA/IHBheWxvYWQgOiB7fSksXG4gICAgICAgIC4uLnJlc29sdmVyLnBhcmFtc1xuICAgICAgfVxuICAgIClcbiAgICBjb25zdCBjb250cm9sbGVySW5zdGFuY2UgPSBuZXcgY29udHJvbGxlckNsYXNzKHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICBjb250cm9sbGVyLFxuICAgICAgcGFyYW1zOiBjb250cm9sbGVyUGFyYW1zLFxuICAgICAgcmVxdWVzdDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LmpzXCIpLmRlZmF1bHR9ICovICh0aGlzLmdldFJlcXVlc3QoKSksXG4gICAgICByZXNwb25zZSxcbiAgICAgIHZpZXdQYXRoXG4gICAgfSlcblxuICAgIC8vIFByZXNlcnZlIHRoZSBjbGllbnQncyBvd24gY29tbWFuZCBhcmd1bWVudHMgYmVmb3JlIHJvdXRlIGZyYW1ld29yayBwYXJhbXMgd29uXG4gICAgLy8gdGhlIGBjb250cm9sbGVyUGFyYW1zYCBtZXJnZSBhYm92ZSwgc28gYSB0eXBlZCBjb21tYW5kIG1ldGhvZCAoYGFzeW5jIG5hbWUoYXJncylgKVxuICAgIC8vIHJlY2VpdmVzIHRoZSBjbGllbnQgcGF5bG9hZCDigJQgbm90IHRoZSByb3V0ZSdzIG1lbWJlciBpZCAvIG1vZGVsIC8gY29udHJvbGxlciBrZXlzLlxuICAgIGNvbnN0IGN1c3RvbUNvbW1hbmRDb250cm9sbGVyID0gLyoqIEB0eXBlIHtGcm9udGVuZE1vZGVsQ29udHJvbGxlcn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGNvbnRyb2xsZXJJbnN0YW5jZSkpXG5cbiAgICBjdXN0b21Db21tYW5kQ29udHJvbGxlci5fZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRDbGllbnRBcmd1bWVudHMgPVxuICAgICAgKHBheWxvYWQgJiYgdHlwZW9mIHBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkocGF5bG9hZCkpID8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKSA6IHt9XG5cbiAgICBhd2FpdCB0aGlzLndpdGhGcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoY29udHJvbGxlclBhcmFtcywgcmVzcG9uc2UsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGNvbnRyb2xsZXJJbnN0YW5jZS5fcnVuQmVmb3JlQ2FsbGJhY2tzKClcbiAgICAgIGNvbnN0IGNvbnRyb2xsZXJNZXRob2RzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZD59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoY29udHJvbGxlckluc3RhbmNlKSlcblxuICAgICAgYXdhaXQgY29udHJvbGxlck1ldGhvZHNbYWN0aW9uXSgpXG4gICAgfSlcblxuICAgIGNvbnN0IHNldENvb2tpZUhlYWRlcnMgPSByZXNwb25zZS5oZWFkZXJzW1wiU2V0LUNvb2tpZVwiXSB8fCBbXVxuXG4gICAgZm9yIChjb25zdCBzZXRDb29raWVIZWFkZXIgb2Ygc2V0Q29va2llSGVhZGVycykge1xuICAgICAgdGhpcy5yZXNwb25zZSgpLmFkZEhlYWRlcihcIlNldC1Db29raWVcIiwgc2V0Q29va2llSGVhZGVyKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IHJlc3BvbnNlLmdldEJvZHkoKVxuXG4gICAgaWYgKHR5cGVvZiByZXNwb25zZUJvZHkgIT09IFwic3RyaW5nXCIgfHwgcmVzcG9uc2VCb2R5Lmxlbmd0aCA8IDEpIHtcbiAgICAgIHJldHVybiB7fVxuICAgIH1cblxuICAgIC8vIFByZXNlcnZlIG5lc3RlZCB0cmFuc3BvcnQgbWFya2VycyBzbyB0aGUgb3V0ZXIgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSVxuICAgIC8vIGNhbiByZXR1cm4gdGhlbSB1bmNoYW5nZWQgYW5kIGxldCB0aGUgY2xpZW50IGh5ZHJhdGUgb25jZSBhdCB0aGUgZWRnZS5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChKU09OLnBhcnNlKHJlc3BvbnNlQm9keSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBpbmRleC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ29sbGVjdGlvbiBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kSW5kZXgoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiaW5kZXhcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGZpbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBmaW5kIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRGaW5kKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImZpbmRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHVwZGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIHVwZGF0ZSBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kVXBkYXRlKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcInVwZGF0ZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgYXR0YWNoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgYXR0YWNoIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRBdHRhY2goKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiYXR0YWNoXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBkb3dubG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGRvd25sb2FkIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmREb3dubG9hZCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJkb3dubG9hZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgdXJsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgVVJMIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRVcmwoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwidXJsXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBjcmVhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBjcmVhdGUgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZENyZWF0ZSgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJjcmVhdGVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGRlc3Ryb3kuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBkZXN0cm95IGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmREZXN0cm95KCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImRlc3Ryb3lcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGN1c3RvbSBjb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDdXN0b20gY29sbGVjdGlvbi9tZW1iZXIgY29tbWFuZCBhY3Rpb24gZm9yIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQ3VzdG9tQ29tbWFuZCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBheWxvYWQoKVxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHJlc3BvbnNlUGF5bG9hZCwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHthY3Rpb246IFwiZnJvbnRlbmRDdXN0b21Db21tYW5kXCIsIGNvbW1hbmRUeXBlOiBcImN1c3RvbS1jb21tYW5kXCIsIGVycm9yfSlcblxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dCksIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGN1c3RvbSBjb21tYW5kIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF5bG9hZCgpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBwYXJhbXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRNZXRob2ROYW1lXG4gICAgY29uc3Qgc2NvcGUgPSBwYXJhbXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRTY29wZVxuXG4gICAgaWYgKHR5cGVvZiBtZXRob2ROYW1lICE9PSBcInN0cmluZ1wiIHx8IG1ldGhvZE5hbWUubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIGZyb250ZW5kLW1vZGVsIGN1c3RvbSBjb21tYW5kIG1ldGhvZCBuYW1lLlwiKVxuICAgIH1cblxuICAgIGlmIChzY29wZSAhPT0gXCJjb2xsZWN0aW9uXCIgJiYgc2NvcGUgIT09IFwibWVtYmVyXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCBmcm9udGVuZC1tb2RlbCBjdXN0b20gY29tbWFuZCBzY29wZS5cIilcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuICAgIGNvbnN0IGNvbW1hbmQgPSByZXNvdXJjZS5yZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lKVxuXG4gICAgaWYgKCFjb21tYW5kKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGBNaXNzaW5nIGZyb250ZW5kLW1vZGVsIGN1c3RvbSBjb21tYW5kICcke21ldGhvZE5hbWV9Jy5gKVxuICAgIH1cblxuICAgIC8vIFBhc3MgdGhlIGNsaWVudCBjb21tYW5kIGFyZ3VtZW50cyBhcyB0aGUgbWV0aG9kJ3MgZmlyc3QgYXJndW1lbnQgc28gYSBjb21tYW5kXG4gICAgLy8gbWV0aG9kIGNhbiB0YWtlIGEgdHlwZWQgYXJncyBvYmplY3QgKGBhc3luYyBuYW1lKGFyZ3MpYCkgYW5kIHRoZSBnZW5lcmF0ZWRcbiAgICAvLyBmcm9udGVuZCBtZXRob2QgY2FuIGZvcndhcmQgdGhlIGJhY2tlbmQgbWV0aG9kJ3MgYEBwYXJhbWAuIGB0aGlzLnBhcmFtcygpYCBpc1xuICAgIC8vIHVuY2hhbmdlZCwgc28gZXhpc3RpbmcgcGFyYW1ldGVybGVzcyBtZXRob2RzIGtlZXAgd29ya2luZy4gVGhlIGFyZ3MgYXJlIHVudHJ1c3RlZFxuICAgIC8vIGNsaWVudCBpbnB1dCB0eXBlZCBvbmx5IGJ5IHRoZSBkZWNsYXJlZCBjb250cmFjdCwgc28gbWV0aG9kcyBtdXN0IHN0aWxsIHZhbGlkYXRlLlxuICAgIGNvbnN0IGNvbW1hbmRBcmd1bWVudHMgPSB0aGlzLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kQXJndW1lbnRzKHBhcmFtcylcbiAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBhd2FpdCBjb21tYW5kLm1ldGhvZC5jYWxsKGNvbW1hbmQucmVzb3VyY2UsIGNvbW1hbmRBcmd1bWVudHMpXG5cbiAgICBpZiAoIXJlc3BvbnNlUGF5bG9hZCB8fCB0eXBlb2YgcmVzcG9uc2VQYXlsb2FkICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4ge3N0YXR1czogXCJzdWNjZXNzXCJ9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoXG4gICAgICBhd2FpdCB0aGlzLmF1dG9TZXJpYWxpemVGcm9udGVuZE1vZGVsc0luUGF5bG9hZChcbiAgICAgICAgcmVzcG9uc2VQYXlsb2FkLFxuICAgICAgICAvKiogQHR5cGUge3tzZXJpYWxpemU6IChtb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFjdGlvbjogc3RyaW5nKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59fSAqLyAoY29tbWFuZC5yZXNvdXJjZSksXG4gICAgICAgIG1ldGhvZE5hbWVcbiAgICAgIClcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHR5cGVkIGFyZ3VtZW50IG9iamVjdCBwYXNzZWQgdG8gYSBjdXN0b20gY29tbWFuZCBtZXRob2QuIE9uIHRoZVxuICAgKiBzaGFyZWQtZW5kcG9pbnQgcGF0aCB0aGUgb3JpZ2luYWwgY2xpZW50IHBheWxvYWQgd2FzIGNhcHR1cmVkIGJlZm9yZSByb3V0ZVxuICAgKiBmcmFtZXdvcmsgcGFyYW1zIHdlcmUgbWVyZ2VkLCBzbyBpdCBpcyByZXR1cm5lZCB2ZXJiYXRpbSAoYSBjbGllbnQgYGlkYCBzdXJ2aXZlc1xuICAgKiBhIG1lbWJlciByb3V0ZSkuIE9uIHRoZSBkaXJlY3QgcGF0aCBpdCBmYWxscyBiYWNrIHRvIHRoZSByZXF1ZXN0IHBhcmFtcyB3aXRoIHRoZVxuICAgKiBmcmFtZXdvcmsga2V5cyB0aGUgY29tbWFuZCByb3V0ZSBob29rIGluamVjdGVkIHN0cmlwcGVkIG91dC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIERlc2VyaWFsaXplZCBmcm9udGVuZC1tb2RlbCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2xpZW50IGNvbW1hbmQgYXJndW1lbnRzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRBcmd1bWVudHMocGFyYW1zKSB7XG4gICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kQ2xpZW50QXJndW1lbnRzKSB7XG4gICAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRDbGllbnRBcmd1bWVudHNcbiAgICB9XG5cbiAgICBjb25zdCB7XG4gICAgICBhY3Rpb246IF9hY3Rpb24sXG4gICAgICBjb250cm9sbGVyOiBfY29udHJvbGxlcixcbiAgICAgIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kTWV0aG9kTmFtZTogX21ldGhvZE5hbWUsXG4gICAgICBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFNjb3BlOiBfc2NvcGUsXG4gICAgICBtb2RlbDogX21vZGVsLFxuICAgICAgLi4uY29tbWFuZEFyZ3VtZW50c1xuICAgIH0gPSBwYXJhbXNcblxuICAgIHJldHVybiBjb21tYW5kQXJndW1lbnRzXG4gIH1cblxuICAvKipcbiAgICogV2Fsa3MgYSBjdXN0b20tY29tbWFuZCByZXNwb25zZSBwYXlsb2FkIGFuZCByZXBsYWNlcyBhbnkgYmFja2VuZCBgUmVjb3JkYFxuICAgKiBpbnN0YW5jZSB3aXRoIHRoZSByZXNvdXJjZSdzIHBlci1hY3Rpb24gc2VyaWFsaXplZCBmb3JtIHNvIGhhbmRsZXJzIGNhblxuICAgKiByZXR1cm4gYHtyZWNvcmQsIHN0YXR1czogXCJva1wifWAgaW5zdGVhZCBvZiBleHBsaWNpdGx5IGNhbGxpbmdcbiAgICogYGF3YWl0IHRoaXMuc2VyaWFsaXplKHJlY29yZCwgYWN0aW9uKWAuIFBsYWluIG9iamVjdHMsIGFycmF5cywgYW5kXG4gICAqIHByaW1pdGl2ZSB2YWx1ZXMgcGFzcyB0aHJvdWdoIGFuZCBhcmUgbGF0ZXIgZW5jb2RlZCBieVxuICAgKiBgc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlYC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBQYXlsb2FkIHZhbHVlLlxuICAgKiBAcGFyYW0ge3tzZXJpYWxpemU6IChtb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFjdGlvbjogc3RyaW5nKSA9PiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59fSByZXNvdXJjZSAtIFJlc291cmNlIGluc3RhbmNlIHByb3ZpZGluZyBgc2VyaWFsaXplYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEN1c3RvbSBjb21tYW5kIG1ldGhvZCBuYW1lIHBhc3NlZCB0byBgcmVzb3VyY2Uuc2VyaWFsaXplYCBmb3IgcGVyLWFjdGlvbiBhdXRob3JpemF0aW9uIGZpbHRlcmluZy5cbiAgICogQHBhcmFtIHtXZWFrU2V0PG9iamVjdD59IFtzZWVuXSAtIFJlY3Vyc2lvbiBzdGFjayBvZiBwbGFpbi1vYmplY3QgY29udGFpbmVycyBjdXJyZW50bHkgYmVpbmcgd2Fsa2VkLiBNZW1iZXJzaGlwIGlzIGFkZGVkIG9uIGVudHJ5IGFuZCByZW1vdmVkIG9uIGV4aXQgc28gYSBjb250YWluZXIgc2hhcmVkIGJldHdlZW4gc2libGluZ3MgKGkuZS4gcmVmZXJlbmNlZCB0d2ljZSBidXQgbm90IGN5Y2xpY2FsbHkpIGlzIHdhbGtlZCBvbiBlYWNoIHJlZmVyZW5jZSBpbnN0ZWFkIG9mIGJlaW5nIHNob3J0LWNpcmN1aXRlZCB0aGUgc2Vjb25kIHRpbWUsIHdoaWNoIHdvdWxkIGxldCBiYWNrZW5kIGBSZWNvcmRgIGluc3RhbmNlcyBpbnNpZGUgaXQgYnlwYXNzIGByZXNvdXJjZS5zZXJpYWxpemVgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUGF5bG9hZCB3aXRoIGJhY2tlbmQgYFJlY29yZGAgaW5zdGFuY2VzIHJlcGxhY2VkIGJ5IHNlcmlhbGl6ZWQgbWFya2Vycy5cbiAgICovXG4gIGFzeW5jIGF1dG9TZXJpYWxpemVGcm9udGVuZE1vZGVsc0luUGF5bG9hZCh2YWx1ZSwgcmVzb3VyY2UsIGFjdGlvbiwgc2VlbiA9IG5ldyBXZWFrU2V0KCkpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfVxuXG4gICAgaWYgKGlzQmFja2VuZE1vZGVsSW5zdGFuY2UodmFsdWUpKSB7XG4gICAgICBjb25zdCByaWNoU2VyaWFsaXplZCA9IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZSh2YWx1ZSwgYWN0aW9uKVxuICAgICAgY29uc3QgbW9kZWxOYW1lID0gdmFsdWUuZ2V0TW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIC8vIFdyYXAgdGhlIHJlc291cmNlLXNlcmlhbGl6ZWQgcGF5bG9hZCBpbiB0aGUgZnJvbnRlbmRfbW9kZWwgdHJhbnNwb3J0XG4gICAgICAvLyBtYXJrZXIuIE1hcmtlci1iYXNlZCBkZWNvZGluZyByb3V0ZXMgdGhyb3VnaCBgaW5zdGFudGlhdGVGcm9tUmVzcG9uc2VgLFxuICAgICAgLy8gc28gYWJpbGl0aWVzIC8gcXVlcnlEYXRhIC8gYXNzb2NpYXRpb25Db3VudHMgLyBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG4gICAgICAvLyBiYWtlZCBpbnRvIHRoZSByaWNoIGF0dHJpYnV0ZXMgYnkgYHJlc291cmNlLnNlcmlhbGl6ZWAgYXJlIHJlc3RvcmVkIG9uXG4gICAgICAvLyB0aGUgY2xpZW50IHdpdGhvdXQgY2FsbGVycyBuZWVkaW5nIHRvIHdyYXAgbW9kZWxzIG1hbnVhbGx5LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgX192ZWxvY2lvdXNfdHlwZTogXCJmcm9udGVuZF9tb2RlbFwiLFxuICAgICAgICBhdHRyaWJ1dGVzOiByaWNoU2VyaWFsaXplZCxcbiAgICAgICAgbW9kZWxOYW1lXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAvKipcbiAgICAgICAqIFJlc3VsdC5cbiAgICAgICAqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCByZXN1bHQgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHZhbHVlKSB7XG4gICAgICAgIHJlc3VsdC5wdXNoKGF3YWl0IHRoaXMuYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKGVudHJ5LCByZXNvdXJjZSwgYWN0aW9uLCBzZWVuKSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdFxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgY29uc3QgY29udGFpbmVyID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh2YWx1ZSlcblxuICAgICAgaWYgKHNlZW4uaGFzKGNvbnRhaW5lcikpIHtcbiAgICAgICAgLy8gQ3ljbGljIGJhY2stcmVmZXJlbmNlIGFsb25nIHRoZSBjdXJyZW50IHJlY3Vyc2lvbiBwYXRoOyB0aGVcbiAgICAgICAgLy8gYW5jZXN0b3IgZnJhbWUgaXMgc3RpbGwgd2Fsa2luZyB0aGlzIGNvbnRhaW5lciBhbmQgd2lsbCBwcm9kdWNlXG4gICAgICAgIC8vIGl0cyBzZXJpYWxpemVkIGZvcm0uIFJldHVybmluZyB0aGUgb3JpZ2luYWwgY29udGFpbmVyIGhlcmVcbiAgICAgICAgLy8gYnJlYWtzIHRoZSBjeWNsZSB3aXRob3V0IGJ5cGFzc2luZyB0aGUgd2Fsa2VyIGZvciBzaWJsaW5ncyB0aGF0XG4gICAgICAgIC8vIHNoYXJlIGEgbm9uLWN5Y2xpYyByZWZlcmVuY2UgKHRob3NlIHJlLWVudGVyIHRoZSBicmFuY2ggYmVsb3dcbiAgICAgICAgLy8gYmVjYXVzZSB0aGUgY29udGFpbmVyIGlzIHJlbW92ZWQgZnJvbSBgc2VlbmAgb24gc3RhY2sgZXhpdCkuXG4gICAgICAgIHJldHVybiBjb250YWluZXJcbiAgICAgIH1cblxuICAgICAgc2Vlbi5hZGQoY29udGFpbmVyKVxuXG4gICAgICB0cnkge1xuICAgICAgICAvKipcbiAgICAgICAgICogUmVzdWx0LlxuICAgICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgICAgIGZvciAoY29uc3QgW2tleSwgbmVzdGVkXSBvZiBPYmplY3QuZW50cmllcyhjb250YWluZXIpKSB7XG4gICAgICAgICAgLy8gYGFzc2lnblNhZmVQcm9wZXJ0eWAgc3RvcmVzIGtleXMgbGlrZSBgX19wcm90b19fYCBhcyBvd25cbiAgICAgICAgICAvLyBkYXRhIHByb3BlcnRpZXMgaW5zdGVhZCBvZiBpbnZva2luZyB0aGUgcHJvdG90eXBlIHNldHRlcixcbiAgICAgICAgICAvLyBzbyBhIGN1c3RvbS1jb21tYW5kIHJlc3BvbnNlIHRoYXQgZWNob2VzIHBhcnNlZCBjbGllbnRcbiAgICAgICAgICAvLyBpbnB1dCBjYW5ub3QgcG9sbHV0ZSBgT2JqZWN0LnByb3RvdHlwZWAgaGVyZS4gVGhlIHRyYW5zcG9ydFxuICAgICAgICAgIC8vIHNlcmlhbGl6ZXIgYXBwbGllcyB0aGUgc2FtZSBwcm90ZWN0aW9uIG9uIGl0cyBvd24gcGFzczsgd2VcbiAgICAgICAgICAvLyBqdXN0IHByZXNlcnZlIGl0IGFjcm9zcyB0aGUgYXV0by1zZXJpYWxpemUgd2Fsay5cbiAgICAgICAgICBhc3NpZ25TYWZlUHJvcGVydHkocmVzdWx0LCBrZXksIGF3YWl0IHRoaXMuYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKG5lc3RlZCwgcmVzb3VyY2UsIGFjdGlvbiwgc2VlbikpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBzZWVuLmRlbGV0ZShjb250YWluZXIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxufVxuIl19