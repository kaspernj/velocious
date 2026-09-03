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
const ATTACHMENT_OWNER_KEY = "__attachmentOwner";
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
            const resource = this._serializationResourceInstanceForModel(model);
            const hasAttachmentOwner = Object.keys(resource?.resourceConfiguration().attachments || {}).length > 0;
            if (!hasPreloaded && !hasCounts && !hasQueryData && !hasAbilities && !hasAttachmentOwner) {
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
            if (hasAttachmentOwner) {
                if (!resource)
                    throw new Error(`Missing frontend model resource for attachment owner ${model.getModelClass().getModelName()}`);
                const modelClass = model.getModelClass();
                serialized[ATTACHMENT_OWNER_KEY] = {
                    recordId: modelPrimaryKeyCacheKey(modelClass.primaryKey(), model.id()),
                    recordType: modelClass.getModelName(),
                    resourceName: resource.modelName()
                };
            }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3RDLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sVUFBVSxNQUFNLGlCQUFpQixDQUFBO0FBQ3hDLE9BQU8seUJBQXlCLE1BQU0sNENBQTRDLENBQUE7QUFDbEYsT0FBTyxRQUFRLE1BQU0sa0NBQWtDLENBQUE7QUFDdkQsT0FBTyxFQUFDLG1EQUFtRCxFQUFDLE1BQU0seUNBQXlDLENBQUE7QUFDM0csT0FBTyxFQUFDLHdDQUF3QyxFQUFFLGdEQUFnRCxFQUFFLHlCQUF5QixFQUFFLHVDQUF1QyxFQUFFLDJDQUEyQyxFQUFDLE1BQU0sMENBQTBDLENBQUE7QUFDcFEsT0FBTyxFQUFDLCtCQUErQixFQUFFLGtCQUFrQixFQUFDLE1BQU0seUJBQXlCLENBQUE7QUFDM0YsT0FBTyxFQUFDLHFDQUFxQyxFQUFDLE1BQU0sOEJBQThCLENBQUE7QUFDbEYsT0FBTyxFQUFDLHNCQUFzQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sMkJBQTJCLENBQUE7QUFDdEYsT0FBTyxFQUFDLHVCQUF1QixFQUFFLGNBQWMsSUFBSSxtQkFBbUIsRUFBRSxjQUFjLElBQUksbUJBQW1CLEVBQUUsY0FBYyxJQUFJLG1CQUFtQixFQUFFLGdCQUFnQixJQUFJLHFCQUFxQixFQUFFLHVCQUF1QixJQUFJLDRCQUE0QixFQUFFLGFBQWEsSUFBSSxrQkFBa0IsRUFBQyxNQUFNLDRCQUE0QixDQUFBO0FBQ2hVLE9BQU8sRUFBQyxrQkFBa0IsRUFBRSxzQ0FBc0MsRUFBRSxzQkFBc0IsRUFBRSxvQ0FBb0MsRUFBQyxNQUFNLDhDQUE4QyxDQUFBO0FBQ3JMLE9BQU8s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R0FBRyw0REFBNEQsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3hGLE1BQU0sT0FBTyxHQUFHLDREQUE0RCxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sSUFBSSxPQUFPLE1BQU0sQ0FBQyxPQUFPLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQzNMLE1BQU0sVUFBVSxHQUFHLDREQUE0RCxDQUFDLENBQUMsTUFBTSxDQUFDLFVBQVUsSUFBSSxPQUFPLE1BQU0sQ0FBQyxVQUFVLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBQzFNLE1BQU0sS0FBSyxHQUFHLE9BQU8sTUFBTSxDQUFDLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFBO1lBQ3pHLE1BQU0sU0FBUyxHQUFHLE9BQU8sTUFBTSxDQUFDLFNBQVMsS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFBO1lBQzdILE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxRQUFRLElBQUksT0FBTyxDQUFDLEVBQUUsSUFBSSxPQUFPLENBQUMsUUFBUSxJQUFJLFVBQVUsQ0FBQyxFQUFFLElBQUksSUFBSSxDQUFBO1lBQzlGLE1BQU0sUUFBUSxHQUFHLFdBQVcsS0FBSyxJQUFJLElBQUksV0FB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QUFHLDREQUE0RCxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFdEYsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLDhEQUE4RDtnQkFDOUQsa0VBQWtFO2dCQUNsRSw2REFBNkQ7Z0JBQzdELGtFQUFrRTtnQkFDbEUsZ0VBQWdFO2dCQUNoRSwrREFBK0Q7Z0JBQy9ELE9BQU8sU0FBUyxDQUFBO1lBQ2xCLENBQUM7WUFFRCxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBRW5CLElBQUksQ0FBQztnQkFDSDs7MkVBRTJEO2dCQUMzRCxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7Z0JBRWpCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7b0JBQ3RELDJEQUEyRDtvQkFDM0QsNERBQTREO29CQUM1RCx5REFBeUQ7b0JBQ3pELDhEQUE4RDtvQkFDOUQsNkRBQTZEO29CQUM3RCxtREFBbUQ7b0JBQ25ELGtCQUFrQixDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsTUFBTSxJQUFJLENBQUMsb0NBQW9DLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQTtnQkFDbEgsQ0FBQztnQkFFRCxPQUFPLE1BQU0sQ0FBQTtZQUNmLENBQUM7b0JBQVMsQ0FBQztnQkFDVCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQ3hCLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0NBRUYiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtyYW5kb21VVUlEfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgQ29udHJvbGxlciBmcm9tIFwiLi9jb250cm9sbGVyLmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIGZyb20gXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIlxuaW1wb3J0IFJlc3BvbnNlIGZyb20gXCIuL2h0dHAtc2VydmVyL2NsaWVudC9yZXNwb25zZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdH0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL2J1aWx0LWluLXJlc291cmNlcy5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24sIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aCwgZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0LCBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzfSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge2NyZWF0ZU9mZmxpbmVHcmFudEZyb21Cb290c3RyYXAsIHZlcmlmeU9mZmxpbmVHcmFudH0gZnJvbSBcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCJcbmltcG9ydCB7c2VydmVyQ2hhbmdlRmVlZFN0b3JlRm9yQ29uZmlndXJhdGlvbn0gZnJvbSBcIi4vc3luYy9zZXJ2ZXItY2hhbmdlLWZlZWQuanNcIlxuaW1wb3J0IHttdXRhdGlvbklkZW1wb3RlbmN5S2V5LCB2ZXJpZnlTaWduZWRNdXRhdGlvbn0gZnJvbSBcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIlxuaW1wb3J0IHtGcm9udGVuZE1vZGVsUXVlcnlFcnJvciwgbm9ybWFsaXplR3JvdXAgYXMgbm9ybWFsaXplUXVlcnlHcm91cCwgbm9ybWFsaXplSm9pbnMgYXMgbm9ybWFsaXplUXVlcnlKb2lucywgbm9ybWFsaXplUGx1Y2sgYXMgbm9ybWFsaXplUXVlcnlQbHVjaywgbm9ybWFsaXplUHJlbG9hZCBhcyBub3JtYWxpemVRdWVyeVByZWxvYWQsIG5vcm1hbGl6ZVNlYXJjaE9wZXJhdG9yIGFzIG5vcm1hbGl6ZVF1ZXJ5U2VhcmNoT3BlcmF0b3IsIG5vcm1hbGl6ZVNvcnQgYXMgbm9ybWFsaXplUXVlcnlTb3J0fSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcXVlcnkuanNcIlxuaW1wb3J0IHthc3NpZ25TYWZlUHJvcGVydHksIGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlLCBpc0JhY2tlbmRNb2RlbEluc3RhbmNlLCBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWV9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy90cmFuc3BvcnQtc2VyaWFsaXphdGlvbi5qc1wiXG5pbXBvcnQge3JlcXVlc3REZXRhaWxzfSBmcm9tIFwiLi9lcnJvci1yZXBvcnRpbmcvcmVxdWVzdC1kZXRhaWxzLmpzXCJcbmltcG9ydCBSb3V0ZXNSZXNvbHZlciBmcm9tIFwiLi9yb3V0ZXMvcmVzb2x2ZXIuanNcIlxuaW1wb3J0IHtWYWxpZGF0aW9uRXJyb3J9IGZyb20gXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiXG5pbXBvcnQgUmVjb3JkTm90Rm91bmRFcnJvciBmcm9tIFwiLi9kYXRhYmFzZS9yZWNvcmQvcmVjb3JkLW5vdC1mb3VuZC1lcnJvci5qc1wiXG5pbXBvcnQge2NhcHR1cmVGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQsIG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0fSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiXG5pbXBvcnQgeyBub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGUgfSBmcm9tIFwiLi9kYXRhYmFzZS9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IGlzRGF0ZSBmcm9tIFwiLi91dGlscy9pcy1kYXRlLmpzXCJcbmltcG9ydCBpc1BsYWluT2JqZWN0IGZyb20gXCIuL3V0aWxzL3BsYWluLW9iamVjdC5qc1wiXG5pbXBvcnQge2NvbXBvc2l0ZU1vZGVsUHJpbWFyeUtleUNvaG9ydFNxbCwgbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXksIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMsIG1vZGVsUHJpbWFyeUtleVZhbHVlRnJvbUNhY2hlS2V5LCByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUsIHNjYWxhck1vZGVsUHJpbWFyeUtleX0gZnJvbSBcIi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHtSYW5zYWNrUXVlcnlFcnJvciwgbm9ybWFsaXplUmFuc2Fja0dyb3VwLCBwYXJzZVJhbnNhY2tTb3J0fSBmcm9tIFwiLi91dGlscy9yYW5zYWNrLmpzXCJcblxuLyoqXG4gKiBGcm9udGVuZE1vZGVsU2VhcmNoIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsU2VhcmNoXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQ29sdW1uIG9yIGF0dHJpYnV0ZSBuYW1lLlxuICogQHByb3BlcnR5IHtcImVxXCIgfCBcImxpa2VcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCJ9IG9wZXJhdG9yIC0gU2VhcmNoIG9wZXJhdG9yLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTZWFyY2ggdmFsdWUuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFNvcnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTb3J0XG4gKiBAcHJvcGVydHkge3N0cmluZ30gY29sdW1uIC0gQXR0cmlidXRlIG5hbWUgdG8gc29ydCBieS5cbiAqIEBwcm9wZXJ0eSB7XCJhc2NcIiB8IFwiZGVzY1wifSBkaXJlY3Rpb24gLSBTb3J0IGRpcmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbEdyb3VwIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsR3JvdXBcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBncm91cCBieS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFBsdWNrIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGcm9udGVuZE1vZGVsUGx1Y2tcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBwbHVjay5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QgbW9kZWwuXG4gKi9cbi8qKlxuICogRnJvbnRlbmRNb2RlbFBhZ2luYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxQYWdpbmF0aW9uXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IGxpbWl0IC0gTWF4aW11bSBudW1iZXIgb2YgcmVjb3Jkcy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gb2Zmc2V0IC0gTnVtYmVyIG9mIHJlY29yZHMgdG8gc2tpcC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGFnZSAtIDEtYmFzZWQgcGFnZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IHBlclBhZ2UgLSBQYWdlIHNpemUuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRDb250ZXh0ICYge1xuICogICBhY3Rpb246IHN0cmluZyxcbiAqICAgZXhwZWN0ZWRFcnJvcjogYm9vbGVhbixcbiAqICAgZnJvbnRlbmRNb2RlbEVuZHBvaW50OiB0cnVlXG4gKiB9fSBGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHRcbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsSW5kZXhRdWVyeU9wdGlvbnMgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5T3B0aW9uc1xuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVBhZ2luYXRpb25dIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBwYWdpbmF0aW9uIHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2luY2x1ZGVTb3J0XSAtIFdoZXRoZXIgZnJvbnRlbmQtbW9kZWwgc29ydCBwYXJhbXMgc2hvdWxkIGJlIGFwcGxpZWQuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBbcmVzb3VyY2VdIC0gUmVzb3VyY2UgcHJvdmlkaW5nIHF1ZXJ5IGhvb2tzLlxuICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdCAmIFJlY29yZDxzeW1ib2wsIFNldDxzdHJpbmc+IHwgdW5kZWZpbmVkPn0gRnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEgKi9cbi8qKlxuICogQGNhbGxiYWNrIEZyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2tcbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZSBiZWluZyBzZXJpYWxpemVkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdCB8IG51bGx9IHJlc291cmNlIC0gUmVzb2x2ZWQgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZSwgaWYgYW55LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cblxuY29uc3QgQVRUQUNITUVOVF9PV05FUl9LRVkgPSBcIl9fYXR0YWNobWVudE93bmVyXCJcblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBwcmVsb2FkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBzdHJpbmdbXSB8IGJvb2xlYW4gfCB1bmRlZmluZWQgfCBudWxsfSBwcmVsb2FkIC0gUHJlbG9hZCBzaG9ydGhhbmQuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbH0gLSBOb3JtYWxpemVkIHByZWxvYWQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQcmVsb2FkKHByZWxvYWQpIHtcbiAgaWYgKCFwcmVsb2FkKSByZXR1cm4gbnVsbFxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVF1ZXJ5UHJlbG9hZChwcmVsb2FkKVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB0aHJvd0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yRm9yUGFyc2VyRXJyb3IoZXJyb3IpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBqb2lucy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGpvaW5zIC0gSm9pbnMgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIE5vcm1hbGl6ZWQgcmVsYXRpb25zaGlwLW9iamVjdCBqb2lucy5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEpvaW5zKGpvaW5zKSB7XG4gIGlmICgham9pbnMpIHJldHVybiBudWxsXG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gbm9ybWFsaXplUXVlcnlKb2lucyhqb2lucylcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgc2VsZWN0LlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2VsZWN0IC0gU2VsZWN0IHBheWxvYWQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IFtyb290TW9kZWxOYW1lXSAtIE9wdGlvbmFsIHJvb3QgbW9kZWwgbmFtZSBmb3Igc2hvcnRoYW5kIHBheWxvYWRzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB8IG51bGx9IC0gTm9ybWFsaXplZCBtb2RlbC1uYW1lIGtleWVkIHNlbGVjdCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxTZWxlY3Qoc2VsZWN0LCByb290TW9kZWxOYW1lID0gbnVsbCkge1xuICBpZiAoIXNlbGVjdCkgcmV0dXJuIG51bGxcblxuICBpZiAodHlwZW9mIHNlbGVjdCA9PT0gXCJzdHJpbmdcIikge1xuICAgIGlmICghcm9vdE1vZGVsTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlbGVjdCBzaG9ydGhhbmQgd2l0aG91dCByb290IG1vZGVsIG5hbWVcIilcbiAgICB9XG5cbiAgICByZXR1cm4ge1tyb290TW9kZWxOYW1lXTogW3NlbGVjdF19XG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3QpKSB7XG4gICAgaWYgKCFyb290TW9kZWxOYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VsZWN0IHNob3J0aGFuZCB3aXRob3V0IHJvb3QgbW9kZWwgbmFtZVwiKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3QpIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWxlY3QgYXR0cmlidXRlIGZvciAke3Jvb3RNb2RlbE5hbWV9OiAke3R5cGVvZiBhdHRyaWJ1dGVOYW1lfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtbcm9vdE1vZGVsTmFtZV06IEFycmF5LmZyb20obmV3IFNldChzZWxlY3QpKX1cbiAgfVxuXG4gIGlmICghaXNQbGFpbk9iamVjdChzZWxlY3QpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VsZWN0IHR5cGU6ICR7dHlwZW9mIHNlbGVjdH1gKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZWQuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT59ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7fVxuXG4gIGZvciAoY29uc3QgW21vZGVsTmFtZSwgc2VsZWN0VmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNlbGVjdCkpIHtcbiAgICBpZiAodHlwZW9mIHNlbGVjdFZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBub3JtYWxpemVkW21vZGVsTmFtZV0gPSBbc2VsZWN0VmFsdWVdXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzZWxlY3RWYWx1ZSkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlbGVjdCB2YWx1ZSBmb3IgJHttb2RlbE5hbWV9OiAke3R5cGVvZiBzZWxlY3RWYWx1ZX1gKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3RWYWx1ZSkge1xuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlbGVjdCBhdHRyaWJ1dGUgZm9yICR7bW9kZWxOYW1lfTogJHt0eXBlb2YgYXR0cmlidXRlTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRbbW9kZWxOYW1lXSA9IEFycmF5LmZyb20obmV3IFNldChzZWxlY3RWYWx1ZSkpXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG5jb25zdCBmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2wgPSBTeW1ib2woXCJmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNcIilcbmNvbnN0IGZyb250ZW5kTW9kZWxHcm91cGVkQ29sdW1uc1N5bWJvbCA9IFN5bWJvbChcImZyb250ZW5kTW9kZWxHcm91cGVkQ29sdW1uc1wiKVxuY29uc3QgZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbCA9IFN5bWJvbChcImZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hcIilcbmNvbnN0IGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JNZXNzYWdlID0gXCJSZXF1ZXN0IGZhaWxlZC5cIlxuXG4vKipcbiAqIEJ1aWxkcyBhIGNsaWVudC1zYWZlIHN5bmMgcmVwbGF5IHZhbGlkYXRpb24gZXJyb3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIENsaWVudC1zYWZlIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gW2NhdXNlXSAtIE9yaWdpbmFsIGNhdXNlLlxuICogQHJldHVybnMge1ZlbG9jaW91c0Vycm9yfSAtIENsaWVudC1zYWZlIHJlcGxheSBlcnJvci5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKG1lc3NhZ2UsIGNhdXNlKSB7XG4gIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKG1lc3NhZ2UsIHtcbiAgICBjYXVzZSxcbiAgICBjb2RlOiBcImZyb250ZW5kX3N5bmNfcmVwbGF5X2Vycm9yXCJcbiAgfSlcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIHF1ZXJ5IG1ldGFkYXRhLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IHF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGF9IC0gUXVlcnkgbWV0YWRhdGEgYWNjZXNzIGhlbHBlci5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpIHtcbiAgcmV0dXJuIC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGF9ICovIChxdWVyeSlcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSBjbGllbnQtc2FmZSBmcm9udGVuZC1tb2RlbCBxdWVyeSBlcnJvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNFcnJvcn0gQ2xpZW50LXNhZmUgcXVlcnkgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKG1lc3NhZ2UpIHtcbiAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUobWVzc2FnZSwge2NvZGU6IFwiZnJvbnRlbmQtbW9kZWwtcXVlcnktZXJyb3JcIn0pXG59XG5cbi8qKlxuICogVGhyb3dzIGEgY2xpZW50LXNhZmUgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZXJyb3IgZm9yIHR5cGVkIHF1ZXJ5IHBhcnNlciBlcnJvcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEVycm9yIHJhaXNlZCB3aGlsZSBub3JtYWxpemluZyBjbGllbnQgcXVlcnkgcGFyYW1zLlxuICogQHJldHVybnMge25ldmVyfSBBbHdheXMgdGhyb3dzLlxuICovXG5mdW5jdGlvbiB0aHJvd0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yRm9yUGFyc2VyRXJyb3IoZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IgfHwgZXJyb3IgaW5zdGFuY2VvZiBSYW5zYWNrUXVlcnlFcnJvcikge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGVycm9yLm1lc3NhZ2UpXG4gIH1cblxuICB0aHJvdyBlcnJvclxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGVycm9yIGNhcnJpZXMgYW4gYGVycm9yLnZlbG9jaW91c2AgbWV0YWRhdGEgYmFnLiBUaGVcbiAqIHByZXNlbmNlIG9mIGFueSBzdWNoIGJhZyBtYXJrcyB0aGUgZXJyb3IgYXMgXCJhbm5vdGF0ZWQgYnkgdGhlXG4gKiBkZXZlbG9wZXIgZm9yIHRoZSBmcm9udGVuZFwiIOKAlCB0aGUgZnJhbWV3b3JrIHRyZWF0cyBpdCBhc1xuICogdXNlci1mYWNpbmc6IHN1cmZhY2UgdGhlIG1lc3NhZ2UsIGZvcndhcmQgdGhlIG1ldGFkYXRhLCBhbmQgc2tpcFxuICogdGhlIG5vaXN5IGVuZHBvaW50LWVycm9yIGxvZy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgZXJyb3IgaGFzIFZlbG9jaW91cyBmcm9udGVuZCBtZXRhZGF0YS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEoZXJyb3IpIHtcbiAgaWYgKCFlcnJvciB8fCB0eXBlb2YgZXJyb3IgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZVxuXG4gIC8vIFJ1bnRpbWUgY2hlY2tzIGFib3ZlIG5hcnJvdyB0aGlzIGNhdWdodCB2YWx1ZSB0byB0aGUgbWV0YWRhdGEgcmVjb3JkIHNoYXBlLlxuICBjb25zdCBlcnJvclJlY29yZCA9IC8qKiBAdHlwZSB7e3ZlbG9jaW91cz86IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9fSAqLyAoZXJyb3IpXG5cbiAgcmV0dXJuIGlzUGxhaW5PYmplY3QoZXJyb3JSZWNvcmQudmVsb2Npb3VzKVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGVycm9yIGlzIGFuIGV4cGVjdGVkIGZyb250ZW5kLW1vZGVsIHVzZXItZmxvdyBmYWlsdXJlLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBlcnJvciBpcyBleHBlY3RlZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEV4cGVjdGVkRXJyb3IoZXJyb3IpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmVjb3JkTm90Rm91bmRFcnJvcikgcmV0dXJuIHRydWVcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHJldHVybiB0cnVlXG4gIGlmIChmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCB2ZWxvY2lvdXMgbWV0YWRhdGEgZm9yIGVycm9yLlxuICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkIHwgbnVsbH0gRnJvbnRlbmQtbW9kZWwgVmVsb2Npb3VzIG1ldGFkYXRhIHdoZW4gcHJlc2VudC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFZlbG9jaW91c01ldGFkYXRhRm9yRXJyb3IoZXJyb3IpIHtcbiAgY29uc3QgZXJyb3JDb2RlID0gZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UgJiYgdHlwZW9mIGVycm9yLmNvZGUgPT09IFwic3RyaW5nXCIgJiYgZXJyb3IuY29kZS5sZW5ndGggPiAwXG4gICAgPyBlcnJvci5jb2RlXG4gICAgOiBudWxsXG5cbiAgaWYgKCFmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikpIHtcbiAgICByZXR1cm4gZXJyb3JDb2RlID8ge2NvZGU6IGVycm9yQ29kZX0gOiBudWxsXG4gIH1cblxuICAvLyBmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YSBndWFyZHMgdGhlIGNhdWdodCB2YWx1ZSBiZWZvcmUgdGhpcyBjYXN0LlxuICBjb25zdCBlcnJvclJlY29yZCA9IC8qKiBAdHlwZSB7e3ZlbG9jaW91czogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH19ICovIChlcnJvcilcbiAgY29uc3QgbWV0YWRhdGEgPSBlcnJvclJlY29yZC52ZWxvY2lvdXNcblxuICByZXR1cm4gZXJyb3JDb2RlID8gey4uLm1ldGFkYXRhLCBjb2RlOiBlcnJvckNvZGV9IDogbWV0YWRhdGFcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsaWVudCBtZXNzYWdlIGZvciBlcnJvci5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzIC0gV2hldGhlciB1bmV4cGVjdGVkIGVycm9yIG1lc3NhZ2VzIG1heSBiZSBleHBvc2VkLlxuICogQHJldHVybnMge3N0cmluZ30gLSBNZXNzYWdlIHNhZmUgdG8gcmV0dXJuIHRvIEFQSSBjbGllbnRzLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsQ2xpZW50TWVzc2FnZUZvckVycm9yKGVycm9yLCBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cykge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZWNvcmROb3RGb3VuZEVycm9yKSB7XG4gICAgcmV0dXJuIFwiUmVjb3JkIG5vdCBmb3VuZC5cIlxuICB9XG5cbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgcmV0dXJuIGVycm9yLm1lc3NhZ2VcbiAgfVxuXG4gIC8vIFZhbGlkYXRpb24gZmFpbHVyZXMgYXJlIGV4cGVjdGVkIHVzZXItZmxvdyBlcnJvcnMuIEFsd2F5cyBmb3J3YXJkIHRoZVxuICAvLyB2YWxpZGF0aW9uIHN1bW1hcnkgc28gdGhlIGNsaWVudCBzaG93cyB0aGUgcmVhbCByZWFzb24gKGUuZy4gXCJOYW1lIGNhbid0XG4gIC8vIGJlIGJsYW5rXCIpIGluc3RlYWQgb2YgdGhlIGdlbmVyaWMgXCJSZXF1ZXN0IGZhaWxlZC5cIiBtZXNzYWdlLCByZWdhcmRsZXNzIG9mXG4gIC8vIHdoZXRoZXIgdGhlIHJhaXNpbmcgY29kZSBhbHNvIGF0dGFjaGVkIGVycm9yLnZlbG9jaW91cyBtZXRhZGF0YS5cbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSB7XG4gICAgcmV0dXJuIGVycm9yLm1lc3NhZ2VcbiAgfVxuXG4gIGlmIChmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikgJiYgZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgIHJldHVybiBlcnJvci5tZXNzYWdlXG4gIH1cblxuICBpZiAoZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMgJiYgZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yLm1lc3NhZ2VcblxuICByZXR1cm4gZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvck1lc3NhZ2Vcbn1cblxuLyoqXG4gKiBSdW5zIGZyb250ZW5kIG1vZGVsIGRlYnVnIHBheWxvYWQgZm9yIGVycm9yLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDdXJyZW50IGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gLSBPcHRpb25hbCBpbnRlcm5hbCBlcnJvciBkZXRhaWxzIHdoZW4gY2xpZW50IGV4cG9zdXJlIGlzIGVuYWJsZWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxEZWJ1Z1BheWxvYWRGb3JFcnJvcih7Y29uZmlndXJhdGlvbiwgZXJyb3J9KSB7XG4gIGlmICghY29uZmlndXJhdGlvbi5nZXRFeHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cygpKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFJlY29yZE5vdEZvdW5kRXJyb3IpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGlmIChmcm9udGVuZE1vZGVsRXJyb3JIYXNWZWxvY2lvdXNNZXRhZGF0YShlcnJvcikpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIGNvbnN0IGRlYnVnRXJyb3JDbGFzcyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3IubmFtZVxuICAgID8gZXJyb3IubmFtZVxuICAgIDogdHlwZW9mIGVycm9yXG4gIGNvbnN0IGRlYnVnRXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgID8gZXJyb3IubWVzc2FnZVxuICAgIDogU3RyaW5nKGVycm9yKVxuICBjb25zdCBkZWJ1Z0JhY2t0cmFjZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgdHlwZW9mIGVycm9yLnN0YWNrID09PSBcInN0cmluZ1wiICYmIGVycm9yLnN0YWNrLmxlbmd0aCA+IDBcbiAgICA/IGVycm9yLnN0YWNrLnNwbGl0KFwiXFxuXCIpXG4gICAgOiB1bmRlZmluZWRcblxuICByZXR1cm4ge1xuICAgIGRlYnVnRXJyb3JDbGFzcyxcbiAgICBkZWJ1Z0Vycm9yTWVzc2FnZSxcbiAgICAuLi4oZGVidWdCYWNrdHJhY2UgPyB7ZGVidWdCYWNrdHJhY2V9IDoge30pXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBzZWFyY2hlcy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNlYXJjaGVzIC0gU2VhcmNoIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAtIE5vcm1hbGl6ZWQgc2VhcmNoZXMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxTZWFyY2hlcyhzZWFyY2hlcykge1xuICBpZiAoIXNlYXJjaGVzKSByZXR1cm4gW11cblxuICBpZiAoIUFycmF5LmlzQXJyYXkoc2VhcmNoZXMpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VhcmNoZXMgdHlwZTogJHt0eXBlb2Ygc2VhcmNoZXN9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVkLlxuICAgKiBAdHlwZSB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAqL1xuICBjb25zdCBub3JtYWxpemVkID0gW11cblxuICBmb3IgKGNvbnN0IHNlYXJjaCBvZiBzZWFyY2hlcykge1xuICAgIGlmICghaXNQbGFpbk9iamVjdChzZWFyY2gpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWFyY2ggZW50cnkgdHlwZTogJHt0eXBlb2Ygc2VhcmNofWApXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IHNlYXJjaC5wYXRoXG4gICAgY29uc3QgY29sdW1uID0gc2VhcmNoLmNvbHVtblxuICAgIGNvbnN0IG9wZXJhdG9yID0gc2VhcmNoLm9wZXJhdG9yXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwiSW52YWxpZCBzZWFyY2ggcGF0aDogZXhwZWN0ZWQgYW4gYXJyYXlcIilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhdGhFbnRyeSBvZiBwYXRoKSB7XG4gICAgICBpZiAodHlwZW9mIHBhdGhFbnRyeSAhPT0gXCJzdHJpbmdcIiB8fCBwYXRoRW50cnkubGVuZ3RoIDwgMSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VhcmNoIHBhdGggZW50cnk6IGV4cGVjdGVkIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbHVtbiAhPT0gXCJzdHJpbmdcIiB8fCBjb2x1bW4ubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlYXJjaCBjb2x1bW46IGV4cGVjdGVkIG5vbi1lbXB0eSBzdHJpbmdcIilcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIG9wZXJhdG9yICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWFyY2ggb3BlcmF0b3I6ICR7b3BlcmF0b3J9YClcbiAgICB9XG5cbiAgICBsZXQgbm9ybWFsaXplZE9wZXJhdG9yXG5cbiAgICB0cnkge1xuICAgICAgbm9ybWFsaXplZE9wZXJhdG9yID0gbm9ybWFsaXplUXVlcnlTZWFyY2hPcGVyYXRvcihvcGVyYXRvcilcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWQucHVzaCh7XG4gICAgICBjb2x1bW4sXG4gICAgICBvcGVyYXRvcjogbm9ybWFsaXplZE9wZXJhdG9yLFxuICAgICAgcGF0aDogWy4uLnBhdGhdLFxuICAgICAgdmFsdWU6IHNlYXJjaC52YWx1ZVxuICAgIH0pXG4gIH1cblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHdoZXJlLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gd2hlcmUgLSBXaGVyZSBwYXlsb2FkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gTm9ybWFsaXplZCB3aGVyZSBoYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmUod2hlcmUpIHtcbiAgaWYgKCF3aGVyZSkgcmV0dXJuIG51bGxcblxuICBpZiAoIWlzUGxhaW5PYmplY3Qod2hlcmUpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgd2hlcmUgdHlwZTogJHt0eXBlb2Ygd2hlcmV9YClcbiAgfVxuXG4gIHJldHVybiB3aGVyZVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHJhbnNhY2suXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByYW5zYWNrIC0gUmFuc2FjayBwYXlsb2FkLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gTm9ybWFsaXplZCBSYW5zYWNrIGhhc2guXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSYW5zYWNrKHJhbnNhY2spIHtcbiAgaWYgKCFyYW5zYWNrKSByZXR1cm4gbnVsbFxuXG4gIGlmICghaXNQbGFpbk9iamVjdChyYW5zYWNrKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHJhbnNhY2sgdHlwZTogJHt0eXBlb2YgcmFuc2Fja31gKVxuICB9XG5cbiAgcmV0dXJuIHJhbnNhY2tcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBpbnRlZ2VyIHBhcmFtLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgaW50ZWdlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUGFyYW0gbmFtZSBmb3IgZXJyb3JzLlxuICogQHBhcmFtIHtudW1iZXJ9IG1pbiAtIE1pbmltdW0gYWxsb3dlZCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSAtIE5vcm1hbGl6ZWQgaW50ZWdlci5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbSh2YWx1ZSwgbmFtZSwgbWluKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtuYW1lfTogZXhwZWN0ZWQgaW50ZWdlciBudW1iZXJgKVxuICB9XG5cbiAgaWYgKHZhbHVlIDwgbWluKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgJHtuYW1lfTogZXhwZWN0ZWQgdmFsdWUgPj0gJHttaW59YClcbiAgfVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHBhZ2luYXRpb24uXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MubGltaXQgLSBMaW1pdCBwYXlsb2FkLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5vZmZzZXQgLSBPZmZzZXQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGFnZSAtIFBhZ2UgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucGVyUGFnZSAtIFBlci1wYWdlIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBhZ2luYXRpb259IC0gTm9ybWFsaXplZCBwYWdpbmF0aW9uIGRhdGEuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtsaW1pdCwgb2Zmc2V0LCBwYWdlLCBwZXJQYWdlfSkge1xuICByZXR1cm4ge1xuICAgIGxpbWl0OiBub3JtYWxpemVGcm9udGVuZE1vZGVsSW50ZWdlclBhcmFtKGxpbWl0LCBcImxpbWl0XCIsIDApLFxuICAgIG9mZnNldDogbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbShvZmZzZXQsIFwib2Zmc2V0XCIsIDApLFxuICAgIHBhZ2U6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0ocGFnZSwgXCJwYWdlXCIsIDEpLFxuICAgIHBlclBhZ2U6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0ocGVyUGFnZSwgXCJwZXJQYWdlXCIsIDEpXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBkaXN0aW5jdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGRpc3RpbmN0IC0gRGlzdGluY3QgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtib29sZWFuIHwgbnVsbH0gLSBOb3JtYWxpemVkIGRpc3RpbmN0IGZsYWcgd2hlbiBwcm92aWRlZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbERpc3RpbmN0KGRpc3RpbmN0KSB7XG4gIGlmIChkaXN0aW5jdCA9PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gIGlmICh0eXBlb2YgZGlzdGluY3QgIT09IFwiYm9vbGVhblwiKSB7XG4gICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgZGlzdGluY3Q6IGV4cGVjdGVkIGJvb2xlYW5gKVxuICB9XG5cbiAgcmV0dXJuIGRpc3RpbmN0XG59XG5cbi8qKlxuICogUnVucyBidWlsZCBmcm9udGVuZCBtb2RlbCBqb2luIG9iamVjdCBmcm9tIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBwYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEpvaW4gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBidWlsZEZyb250ZW5kTW9kZWxKb2luT2JqZWN0RnJvbVBhdGgocGF0aCkge1xuICAvKipcbiAgICogSm9pbiBvYmplY3QuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IGpvaW5PYmplY3QgPSB7fVxuICAvKipcbiAgICogQ3VycmVudCBub2RlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBsZXQgY3VycmVudE5vZGUgPSBqb2luT2JqZWN0XG5cbiAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIHBhdGgpIHtcbiAgICBjdXJyZW50Tm9kZVtyZWxhdGlvbnNoaXBOYW1lXSA9IHt9XG4gICAgY3VycmVudE5vZGUgPSBjdXJyZW50Tm9kZVtyZWxhdGlvbnNoaXBOYW1lXVxuICB9XG5cbiAgcmV0dXJuIGpvaW5PYmplY3Rcbn1cblxuLyoqXG4gKiBCdWlsZCBhIHN1Y2Nlc3NmdWwgc2luZ2xlLW1vZGVsIGZyb250ZW5kLW1vZGVsIHJlc3BvbnNlIHBheWxvYWQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gbW9kZWwgLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7e21vZGVsOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN0YXR1czogXCJzdWNjZXNzXCJ9fSAtIFN1Y2Nlc3MgcmVzcG9uc2UgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbFNlcmlhbGl6ZWRNb2RlbFN1Y2Nlc3MobW9kZWwpIHtcbiAgcmV0dXJuIHttb2RlbCwgc3RhdHVzOiBcInN1Y2Nlc3NcIn1cbn1cblxuLyoqXG4gKiBSZXNvbHZlIGFuZCB2YWxpZGF0ZSBhdHRhY2htZW50IHBhcmFtcyBzaGFyZWQgYnkgYXR0YWNobWVudCBjb21tYW5kcy5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBGcm9udGVuZC1tb2RlbCByZXF1ZXN0IHBhcmFtcy5cbiAqIEByZXR1cm5zIHt7YXR0YWNobWVudElkOiBzdHJpbmcgfCB1bmRlZmluZWQsIGF0dGFjaG1lbnROYW1lOiBzdHJpbmd9IHwgc3RyaW5nfSAtIEF0dGFjaG1lbnQgcGFyYW1zIG9yIHZhbGlkYXRpb24gZXJyb3IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKSB7XG4gIGNvbnN0IGF0dGFjaG1lbnROYW1lID0gcGFyYW1zLmF0dGFjaG1lbnROYW1lXG5cbiAgaWYgKHR5cGVvZiBhdHRhY2htZW50TmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBhdHRhY2htZW50TmFtZS5sZW5ndGggPCAxKSB7XG4gICAgcmV0dXJuIFwiRXhwZWN0ZWQgYXR0YWNobWVudE5hbWUuXCJcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYXR0YWNobWVudElkOiB0eXBlb2YgcGFyYW1zLmF0dGFjaG1lbnRJZCA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5hdHRhY2htZW50SWQgOiB1bmRlZmluZWQsXG4gICAgYXR0YWNobWVudE5hbWVcbiAgfVxufVxuXG4vKipcbiAqIEV4dHJhY3QgbXV0YXRpb24gYXR0cmlidXRlcyBzaGFyZWQgYnkgY3JlYXRlIGFuZCB1cGRhdGUgY29tbWFuZHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gRnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBwYXJhbXMuXG4gKiBAcmV0dXJucyB7e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYXR0YWNobWVudHM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGwsIG5lc3RlZEF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IHwgc3RyaW5nfSAtIE11dGF0aW9uIGF0dHJpYnV0ZXMgb3IgdmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcykge1xuICBjb25zdCBhdHRyaWJ1dGVzID0gcGFyYW1zLmF0dHJpYnV0ZXNcblxuICBpZiAoIWlzUGxhaW5PYmplY3QoYXR0cmlidXRlcykpIHtcbiAgICByZXR1cm4gXCJFeHBlY3RlZCBtb2RlbCBhdHRyaWJ1dGVzLlwiXG4gIH1cblxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgcmVndWxhckF0dHJpYnV0ZXMgPSB7fVxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgY29uc3QgbmVzdGVkQXR0cmlidXRlcyA9IHt9XG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF0dHJpYnV0ZXMpKSB7XG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUuZW5kc1dpdGgoXCJBdHRyaWJ1dGVzXCIpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBOYW1lID0gYXR0cmlidXRlTmFtZS5zbGljZSgwLCAtXCJBdHRyaWJ1dGVzXCIubGVuZ3RoKVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHJldHVybiBgSW52YWxpZCBuZXN0ZWQgYXR0cmlidXRlcyBrZXk6ICR7YXR0cmlidXRlTmFtZX1gXG4gICAgICBuZXN0ZWRBdHRyaWJ1dGVzW3JlbGF0aW9uc2hpcE5hbWVdID0gdmFsdWVcbiAgICB9IGVsc2Uge1xuICAgICAgcmVndWxhckF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cbiAgfVxuXG4gIGlmIChwYXJhbXMubmVzdGVkQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHBhcmFtcy5uZXN0ZWRBdHRyaWJ1dGVzKSkgcmV0dXJuIFwiRXhwZWN0ZWQgbmVzdGVkQXR0cmlidXRlcyB0byBiZSBhbiBvYmplY3QuXCJcblxuICAgIE9iamVjdC5hc3NpZ24obmVzdGVkQXR0cmlidXRlcywgcGFyYW1zLm5lc3RlZEF0dHJpYnV0ZXMpXG4gIH1cblxuICBpZiAocGFyYW1zLmF0dGFjaG1lbnRzICE9PSB1bmRlZmluZWQgJiYgIWlzUGxhaW5PYmplY3QocGFyYW1zLmF0dGFjaG1lbnRzKSkge1xuICAgIHJldHVybiBcIkV4cGVjdGVkIGF0dGFjaG1lbnRzIHRvIGJlIGFuIG9iamVjdC5cIlxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBhdHRyaWJ1dGVzOiByZWd1bGFyQXR0cmlidXRlcyxcbiAgICBhdHRhY2htZW50czogcGFyYW1zLmF0dGFjaG1lbnRzID09PSB1bmRlZmluZWQgPyBudWxsIDogcGFyYW1zLmF0dGFjaG1lbnRzLFxuICAgIG5lc3RlZEF0dHJpYnV0ZXM6IE9iamVjdC5rZXlzKG5lc3RlZEF0dHJpYnV0ZXMpLmxlbmd0aCA+IDAgPyBuZXN0ZWRBdHRyaWJ1dGVzIDogbnVsbFxuICB9XG59XG5cbi8qKiBDb250cm9sbGVyIHdpdGggYnVpbHQtaW4gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgYWN0aW9ucy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZyb250ZW5kTW9kZWxDb250cm9sbGVyIGV4dGVuZHMgQ29udHJvbGxlciB7XG4gIC8qKlxuICAgKiBGcm9udGVuZCBtb2RlbCBwYXJhbXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsUGFyYW1zID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBGcm9udGVuZCBtb2RlbCBwYXJhbXMgb3ZlcnJpZGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIEZyb250ZW5kIG1vZGVsIGFiaWxpdHkgb3ZlcnJpZGUuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogT3JpZ2luYWwgZGVzZXJpYWxpemVkIGN1c3RvbS1jb21tYW5kIGNsaWVudCBwYXlsb2FkLCBjYXB0dXJlZCBiZWZvcmUgcm91dGVcbiAgICogZnJhbWV3b3JrIHBhcmFtcyBhcmUgbWVyZ2VkIGluLCBzbyBhIHR5cGVkIGNvbW1hbmQgbWV0aG9kIHJlY2VpdmVzIHRoZSBjbGllbnQnc1xuICAgKiBvd24gYXJndW1lbnRzIHJhdGhlciB0aGFuIHRoZSByb3V0ZSBtZXRhZGF0YS4gT25seSBzZXQgb24gdGhlIHNoYXJlZC1lbmRwb2ludCBwYXRoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRDbGllbnRBcmd1bWVudHMgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIFJlcXVlc3Qtc2NvcGVkIGNhY2hlIGZvciBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlcy5cbiAgICogS2V5ZWQgYnkgbW9kZWwgY2xhc3MsIHRoZW4gYnkgd2hldGhlciB0aGUgcmVzb3VyY2UgaXMgZm9yIGEgcmVsYXRlZCBtb2RlbFxuICAgKiAoc28gc2VsZi1yZWZlcmVudGlhbCByZWxhdGlvbnNoaXBzIGRvIG5vdCBhY2NpZGVudGFsbHkgcmV1c2Ugcm9vdCBwYXJhbXMpLlxuICAgKiBAdHlwZSB7TWFwPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBNYXA8Ym9vbGVhbiwgaW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQ+PiB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIE9wdGlvbmFsIHBlci1pbnN0YW5jZSBob29rIGludm9rZWQgZm9yIGV2ZXJ5IHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2VcbiAgICogcmVzb2x1dGlvbi4gSW50ZW5kZWQgZm9yIHRlc3RzIGFuZCBiZW5jaG1hcmtzOyBhYnNlbnQgaW4gcHJvZHVjdGlvbi5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgfCBudWxsIHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBEZWNvZGVkIHJlcXVlc3QgcGFyYW1zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFBhcmFtcygpIHtcbiAgICBpZiAodGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlKSB7XG4gICAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlXG4gICAgfVxuXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtcyB8fD0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcblxuICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aXRoIGZyb250ZW5kIG1vZGVsIHBhcmFtcy5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFRlbXBvcmFyeSBmcm9udGVuZCBtb2RlbCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBleGVjdXRlZCB3aXRoIHRlbXBvcmFyeSBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHdpdGhGcm9udGVuZE1vZGVsUGFyYW1zKHBhcmFtcywgY2FsbGJhY2spIHtcbiAgICBjb25zdCBwcmV2aW91c092ZXJyaWRlID0gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlXG4gICAgY29uc3QgcHJldmlvdXNQYXJhbXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zXG4gICAgY29uc3QgcHJldmlvdXNTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzXG5cbiAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgPSBwYXJhbXNcbiAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlcyA9IHVuZGVmaW5lZFxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZSA9IHByZXZpb3VzT3ZlcnJpZGVcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXMgPSBwcmV2aW91c1BhcmFtc1xuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlcyA9IHByZXZpb3VzU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBmcm9udGVuZCBtb2RlbCByZXF1ZXN0IGNvbnRleHQuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0LXNjb3BlZCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVzcG9uc2UuanNcIikuZGVmYXVsdH0gcmVzcG9uc2UgLSBSZXNwb25zZSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGV4ZWN1dGVkIGluc2lkZSByZXNvbHZlZCB0ZW5hbnQgYW5kIGFiaWxpdHkgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgd2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChwYXJhbXMsIHJlc3BvbnNlLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHRlbmFudCA9IGNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50UmVzb2x2ZXIoKVxuICAgICAgPyBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkZyb250ZW5kIG1vZGVsIHJlcXVlc3QgdGVuYW50IHJlc29sdXRpb25cIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlVGVuYW50KHtcbiAgICAgICAgICAgIHBhcmFtcyxcbiAgICAgICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpLFxuICAgICAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICB9KVxuICAgICAgICB9KVxuICAgICAgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCByZXF1ZXN0XCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGFiaWxpdHkgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJlc29sdmVBYmlsaXR5KHtcbiAgICAgICAgICBwYXJhbXMsXG4gICAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0KCksXG4gICAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgfSlcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFByZXZpb3VzIGFiaWxpdHkgb3ZlcnJpZGUuXG4gICAgICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICAgICAgICBjb25zdCBwcmV2aW91c0FiaWxpdHlPdmVycmlkZSA9IHRoaXMuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGVcblxuICAgICAgICB0aGlzLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gYWJpbGl0eVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgICAgICB9KVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSBwcmV2aW91c0FiaWxpdHlPdmVycmlkZVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjdXJyZW50IGFiaWxpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgYWJpbGl0eSBmb3IgZnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBzY29wZS5cbiAgICovXG4gIGN1cnJlbnRBYmlsaXR5KCkge1xuICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlIHx8IHN1cGVyLmN1cnJlbnRBYmlsaXR5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgZm9yIGNvbnRyb2xsZXIgcmVzb3VyY2UgYWN0aW9ucy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzc0Zyb21Db25maWd1cmF0aW9uKClcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHR5cGVvZiBwYXJhbXMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMubW9kZWwgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHR5cGVvZiBwYXJhbXMuY29udHJvbGxlciA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoZnJvbnRlbmRNb2RlbENsYXNzKSByZXR1cm4gZnJvbnRlbmRNb2RlbENsYXNzXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIGNvbmZpZ3VyZWQgZm9yIG1vZGVsICcke21vZGVsTmFtZSB8fCBcInVua25vd25cIn0nIGFuZCBjb250cm9sbGVyICcke2NvbnRyb2xsZXJOYW1lIHx8IFwidW5rbm93blwifScuIEVuc3VyZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3MgZXhpc3RzIGluIHNyYy9yZXNvdXJjZXMvIG9yIGlzIGxpc3RlZCBpbiB0aGUgYWJpbGl0eSByZXNvbHZlci5gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbiwgbW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgY3VycmVudCBjb250cm9sbGVyLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuICAgIGNvbnN0IG1vZGVsTmFtZSA9IHR5cGVvZiBwYXJhbXMubW9kZWwgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMubW9kZWwgOiB1bmRlZmluZWRcbiAgICBjb25zdCBjb250cm9sbGVyTmFtZSA9IHR5cGVvZiBwYXJhbXMuY29udHJvbGxlciA9PT0gXCJzdHJpbmdcIiA/IHBhcmFtcy5jb250cm9sbGVyIDogdW5kZWZpbmVkXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG5cbiAgICAgIGlmIChtb2RlbE5hbWUgJiYgbW9kZWxOYW1lLmxlbmd0aCA+IDAgJiYgcmVzb3VyY2VzW21vZGVsTmFtZV0pIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsTmFtZV1cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uIHx8ICFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSAnJHttb2RlbE5hbWV9JyBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzc2ApXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICAgIG1vZGVsTmFtZSxcbiAgICAgICAgICByZXNvdXJjZUNsYXNzLFxuICAgICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvblxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghY29udHJvbGxlck5hbWUgfHwgY29udHJvbGxlck5hbWUubGVuZ3RoIDwgMSkgY29udGludWVcblxuICAgICAgZm9yIChjb25zdCByZXNvdXJjZU1vZGVsTmFtZSBpbiByZXNvdXJjZXMpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW3Jlc291cmNlTW9kZWxOYW1lXVxuICAgICAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24gfHwgIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZyb250ZW5kIG1vZGVsIHJlc291cmNlICcke3Jlc291cmNlTW9kZWxOYW1lfScgbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3NgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VQYXRoID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKHJlc291cmNlTW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pXG5cbiAgICAgICAgaWYgKHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlTWF0Y2hlc0NvbnRyb2xsZXIoe2NvbnRyb2xsZXJOYW1lLCByZXNvdXJjZVBhdGh9KSkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgICAgIG1vZGVsTmFtZTogcmVzb3VyY2VNb2RlbE5hbWUsXG4gICAgICAgICAgICByZXNvdXJjZUNsYXNzLFxuICAgICAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIGJhY2tlbmQgcHJvamVjdCBtb2RlbCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBhcmdzLmJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1vZGVsTmFtZSAtIE1vZGVsIG5hbWUuXG4gICAqIEByZXR1cm5zIHt7YmFja2VuZFByb2plY3Q6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlLCByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gfCBudWxsfSAtIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIG1vZGVsIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWV9KSB7XG4gICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbE5hbWVdXG5cbiAgICBpZiAoIXJlc291cmNlRGVmaW5pdGlvbikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgaWYgKCFyZXNvdXJjZUNvbmZpZ3VyYXRpb24gfHwgIXJlc291cmNlQ2xhc3MpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICBtb2RlbE5hbWUsXG4gICAgICByZXNvdXJjZUNsYXNzLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3tiYWNrZW5kUHJvamVjdDogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbiwgbW9kZWxOYW1lOiBzdHJpbmcsIHJlc291cmNlQ2xhc3M6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9ufSB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhmcm9udGVuZE1vZGVsUmVzb3VyY2UpID09PSBtb2RlbENsYXNzKSB7XG4gICAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtcbiAgICAgIGJhY2tlbmRQcm9qZWN0OiBmcm9udGVuZE1vZGVsUmVzb3VyY2UuYmFja2VuZFByb2plY3QsXG4gICAgICBtb2RlbE5hbWU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7e21vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfX0gZnJvbnRlbmRNb2RlbFJlc291cmNlIC0gRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEJhY2tpbmcgcmVjb3JkIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHtcbiAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3MubW9kZWxDbGFzcygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjbGFzcyBmcm9tIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IC0gRnJvbnRlbmQgbW9kZWwgY2xhc3MgcmVzb2x2ZWQgZnJvbSBiYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxDbGFzc0Zyb21Db25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGZyb250ZW5kIG1vZGVsIGNsYXNzIGFuZCByZXF1ZXN0ZWQgcHJlbG9hZCB0YXJnZXQgY2xhc3NlcyBhcmUgaW5pdGlhbGl6ZWQuXG4gICAqIFRoaXMgaGFuZGxlcyB0aGUgY2FzZSB3aGVyZSBtb2RlbCBpbml0aWFsaXphdGlvbiB3YXMgc2tpcHBlZCBhdCBzdGFydHVwIChlLmcuLCBicm93c2VyIHRlc3RzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgY2xhc3MgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcm9udGVuZE1vZGVsQ2xhc3NJbml0aWFsaXplZCgpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzc0Zyb21Db25maWd1cmF0aW9uKClcblxuICAgIGlmICghbW9kZWxDbGFzcykgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxSZWNvcmRDbGFzc0luaXRpYWxpemVkKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxQcmVsb2FkQ2xhc3Nlc0luaXRpYWxpemVkKHtcbiAgICAgIGJhY2tlbmRQcm9qZWN0OiBmcm9udGVuZE1vZGVsUmVzb3VyY2UuYmFja2VuZFByb2plY3QsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgcHJlbG9hZDogdGhpcy5mcm9udGVuZE1vZGVsUHJlbG9hZCgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCByZWNvcmQgY2xhc3MgaW5pdGlhbGl6ZWQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBpbml0aWFsaXplLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBtb2RlbCBjbGFzcyBpcyByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyb250ZW5kTW9kZWxSZWNvcmRDbGFzc0luaXRpYWxpemVkKG1vZGVsQ2xhc3MpIHtcbiAgICBpZiAoIW1vZGVsQ2xhc3MgfHwgbW9kZWxDbGFzcy5pc0luaXRpYWxpemVkKCkpIHJldHVyblxuXG4gICAgYXdhaXQgbW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCh7Y29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5zdXJlIGZyb250ZW5kIG1vZGVsIHByZWxvYWQgY2xhc3NlcyBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYXJncy5iYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB3aG9zZSBwcmVsb2FkIHRyZWUgaXMgYmVpbmcgcmVzb2x2ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgbnVsbH0gYXJncy5wcmVsb2FkIC0gTm9ybWFsaXplZCBwcmVsb2FkIHRyZWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZCB0YXJnZXQgY2xhc3NlcyBhcmUgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcm9udGVuZE1vZGVsUHJlbG9hZENsYXNzZXNJbml0aWFsaXplZCh7YmFja2VuZFByb2plY3QsIG1vZGVsQ2xhc3MsIHByZWxvYWR9KSB7XG4gICAgaWYgKCFwcmVsb2FkKSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcFByZWxvYWRdIG9mIE9iamVjdC5lbnRyaWVzKHByZWxvYWQpKSB7XG4gICAgICBpZiAocmVsYXRpb25zaGlwUHJlbG9hZCA9PT0gZmFsc2UpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBwcmVsb2FkIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldENsYXNzSW5pdGlhbGl6ZWQoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgcmVsYXRpb25zaGlwXG4gICAgICB9KVxuXG4gICAgICBpZiAoIXRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgaWYgKGlzUGxhaW5PYmplY3QocmVsYXRpb25zaGlwUHJlbG9hZCkgJiYgT2JqZWN0LmtleXMocmVsYXRpb25zaGlwUHJlbG9hZCkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGxldCBtZXNzYWdlID0gYENhbm5vdCBwcmVsb2FkIG5lc3RlZCByZWxhdGlvbnNoaXBzIHRocm91Z2ggcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX0gYmVjYXVzZSBpdHMgdGFyZ2V0IG1vZGVsIGNsYXNzIGNvdWxkIG5vdCBiZSByZXNvbHZlZGBcblxuICAgICAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSAmJiByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgICAgICBtZXNzYWdlID0gYENhbm5vdCBwcmVsb2FkIG5lc3RlZCByZWxhdGlvbnNoaXBzIHRocm91Z2ggcG9seW1vcnBoaWMgcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IobWVzc2FnZSlcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghaXNQbGFpbk9iamVjdChyZWxhdGlvbnNoaXBQcmVsb2FkKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUHJlbG9hZENsYXNzZXNJbml0aWFsaXplZCh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICBwcmVsb2FkOiAvKiogQHR5cGUge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZH0gKi8gKHJlbGF0aW9uc2hpcFByZWxvYWQpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCByZWxhdGlvbnNoaXAgdGFyZ2V0IGNsYXNzIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBhcmdzLmJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLCB3aGVuIGF2YWlsYWJsZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBUYXJnZXRDbGFzc0luaXRpYWxpemVkKHtiYWNrZW5kUHJvamVjdCwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXAudGhyb3VnaCkge1xuICAgICAgY29uc3QgdGhyb3VnaFJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcC5nZXRNb2RlbENsYXNzKCkuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC50aHJvdWdoKVxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwVGFyZ2V0Q2xhc3NJbml0aWFsaXplZCh7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgICByZWxhdGlvbnNoaXA6IHRocm91Z2hSZWxhdGlvbnNoaXBcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICByZWxhdGlvbnNoaXBcbiAgICB9KVxuXG4gICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUmVjb3JkQ2xhc3NJbml0aWFsaXplZCh0YXJnZXRNb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlbGF0aW9uc2hpcCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGFyZ3MuYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBUYXJnZXQgbW9kZWwgY2xhc3MsIHdoZW4gYXZhaWxhYmxlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3Moe2JhY2tlbmRQcm9qZWN0LCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRQb2x5bW9ycGhpYygpICYmIHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT09IFwiYmVsb25nc1RvXCIpIHJldHVybiBudWxsXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmtsYXNzKSByZXR1cm4gcmVsYXRpb25zaGlwLmtsYXNzXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmNsYXNzTmFtZSkge1xuICAgICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgbW9kZWxOYW1lOiByZWxhdGlvbnNoaXAuY2xhc3NOYW1lXG4gICAgICB9KVxuICAgICAgY29uc3QgcmVzb3VyY2VNb2RlbENsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlID8gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKGZyb250ZW5kTW9kZWxSZXNvdXJjZSkgOiBudWxsXG5cbiAgICAgIGlmIChyZXNvdXJjZU1vZGVsQ2xhc3MpIHJldHVybiByZXNvdXJjZU1vZGVsQ2xhc3NcblxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE1vZGVsQ2xhc3MgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRNb2RlbENsYXNzZXMoKVtyZWxhdGlvbnNoaXAuY2xhc3NOYW1lXVxuXG4gICAgICBpZiAocmVnaXN0ZXJlZE1vZGVsQ2xhc3MpIHJldHVybiByZWdpc3RlcmVkTW9kZWxDbGFzc1xuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzcyB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgY2xhc3MgbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVzb3VyY2VEZWZpbml0aW9uIC0gUmVzb3VyY2UgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHJlc291cmNlIHBhdGguXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZVBhdGgobW9kZWxOYW1lLCByZXNvdXJjZURlZmluaXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBtYXRjaGVzIGNvbnRyb2xsZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb250cm9sbGVyTmFtZSAtIENvbnRyb2xsZXIgbmFtZSBmcm9tIHBhcmFtcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VQYXRoIC0gUmVzb3VyY2UgcGF0aCBmcm9tIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVzb3VyY2UgcGF0aCBtYXRjaGVzIGN1cnJlbnQgY29udHJvbGxlci5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZU1hdGNoZXNDb250cm9sbGVyKHtjb250cm9sbGVyTmFtZSwgcmVzb3VyY2VQYXRofSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRDb250cm9sbGVyID0gY29udHJvbGxlck5hbWUucmVwbGFjZSgvXlxcLyt8XFwvKyQvZywgXCJcIilcbiAgICBjb25zdCBub3JtYWxpemVkUmVzb3VyY2VQYXRoID0gcmVzb3VyY2VQYXRoLnJlcGxhY2UoL15cXC8rfFxcLyskL2csIFwiXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZFJlc291cmNlUGF0aCA9PT0gbm9ybWFsaXplZENvbnRyb2xsZXIpIHJldHVybiB0cnVlXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFJlc291cmNlUGF0aC5lbmRzV2l0aChgLyR7bm9ybWFsaXplZENvbnRyb2xsZXJ9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IC0gQmFja2VuZCByZXNvdXJjZSBpbnN0YW5jZSBmb3IgY3VycmVudCBmcm9udGVuZC1tb2RlbCBhY3Rpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgY29uZmlndXJhdGlvbiBmb3IgY29udHJvbGxlciAnJHt0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5jb250cm9sbGVyfSdgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlQXJncyA9IHtcbiAgICAgIGFiaWxpdHk6IHRoaXMuY3VycmVudEFiaWxpdHkoKSxcbiAgICAgIGNvbnRyb2xsZXI6IHRoaXMsXG4gICAgICBjb250ZXh0OiB7XG4gICAgICAgIC4uLih0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldENvbnRleHQoKSB8fCB7fSksXG4gICAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpXG4gICAgICB9LFxuICAgICAgbG9jYWxzOiB0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldExvY2FscygpIHx8IHt9LFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSxcbiAgICAgIG1vZGVsTmFtZTogZnJvbnRlbmRNb2RlbFJlc291cmNlLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNsYXNzKHJlc291cmNlQXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlEZWZpbml0aW9ufSAtIEZyb250ZW5kIG1vZGVsIHByaW1hcnkga2V5LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5wcmltYXJ5S2V5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGFiaWxpdHkgYWN0aW9uLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWJpbGl0eSBhY3Rpb24gY29uZmlndXJlZCBmb3IgdGhlIGZyb250ZW5kIGFjdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxBYmlsaXR5QWN0aW9uKGFjdGlvbikge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBjb250cm9sbGVyICcke3RoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLmNvbnRyb2xsZXJ9J2ApXG4gICAgfVxuXG4gICAgY29uc3QgYWJpbGl0aWVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5hYmlsaXRpZXNcblxuICAgIGlmICghYWJpbGl0aWVzIHx8IHR5cGVvZiBhYmlsaXRpZXMgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgJyR7ZnJvbnRlbmRNb2RlbFJlc291cmNlLm1vZGVsTmFtZX0nIG11c3QgZGVmaW5lIGFuICdhYmlsaXRpZXMnIG9iamVjdGApXG4gICAgfVxuXG4gICAgY29uc3QgYWJpbGl0eUtleSA9IGFjdGlvbiA9PT0gXCJhdHRhY2hcIlxuICAgICAgPyBcInVwZGF0ZVwiXG4gICAgICA6ICgoYWN0aW9uID09PSBcImRvd25sb2FkXCIgfHwgYWN0aW9uID09PSBcInVybFwiIHx8IGFjdGlvbiA9PT0gXCJhdHRhY2htZW50TGlzdFwiKSA/IFwiZmluZFwiIDogYWN0aW9uKVxuICAgIGNvbnN0IGFiaWxpdHlBY3Rpb24gPSBhYmlsaXRpZXNbYWJpbGl0eUtleV1cblxuICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVzb3VyY2UgJyR7ZnJvbnRlbmRNb2RlbFJlc291cmNlLm1vZGVsTmFtZX0nIG11c3QgZGVmaW5lIGFiaWxpdGllcy4ke2FiaWxpdHlLZXl9YClcbiAgICB9XG5cbiAgICByZXR1cm4gYWJpbGl0eUFjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYWJpbGl0eSBhdXRob3JpemVkIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQgcXVlcnkgZm9yIHRoZSBhY3Rpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeShhY3Rpb24pIHtcbiAgICBjb25zdCBhYmlsaXR5QWN0aW9uID0gdGhpcy5mcm9udGVuZE1vZGVsQWJpbGl0eUFjdGlvbihhY3Rpb24pXG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKS5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24sIHRoaXMuY3VycmVudEFiaWxpdHkoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCBxdWVyeSBmb3IgdGhlIGFjdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoYWN0aW9uKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcblxuICAgIGlmIChyZXNvdXJjZS5hdXRob3JpemVkUXVlcnkgIT09IEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2UucHJvdG90eXBlLmF1dGhvcml6ZWRRdWVyeSkge1xuICAgICAgcmV0dXJuIHJlc291cmNlLmF1dGhvcml6ZWRRdWVyeShhY3Rpb24pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEFiaWxpdHlBdXRob3JpemVkUXVlcnkoYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWV9IC0gUHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleVZhbHVlKG1vZGVsKSB7XG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuXG4gICAgcmV0dXJuIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBhdXRob3JpemVkIGlkZW50aXRpZXMgZnJvbSBhIGNhbmRpZGF0ZSBjb2hvcnQgd2l0aG91dCBwZXItcmVjb3JkIHF1ZXJpZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5VmFsdWVbXX0gYXJncy5pZGVudGl0aWVzIC0gQ2FuZGlkYXRlIGlkZW50aXRpZXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIG93bmluZyB0aGUgaWRlbnRpdHkgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IGFyZ3MucHJpbWFyeUtleSAtIElkZW50aXR5IGRlZmluaXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNldDxzdHJpbmc+Pn0gLSBDYW5vbmljYWwgYXV0aG9yaXplZCBpZGVudGl0eSBrZXlzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRJZGVudGl0eVNldCh7aWRlbnRpdGllcywgbW9kZWxDbGFzcywgcHJpbWFyeUtleSwgcXVlcnl9KSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHByaW1hcnlLZXkpKSB7XG4gICAgICBjb25zdCBhdXRob3JpemVkSWRzID0gYXdhaXQgcXVlcnlcbiAgICAgICAgLndoZXJlKHtbcHJpbWFyeUtleV06IGlkZW50aXRpZXN9KVxuICAgICAgICAucGx1Y2socHJpbWFyeUtleSlcblxuICAgICAgcmV0dXJuIG5ldyBTZXQoYXV0aG9yaXplZElkcy5tYXAoKHZhbHVlKSA9PiBtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCB2YWx1ZSkpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvaG9ydHMgPSBxdWVyeS5kcml2ZXIuY2h1bmtWYWx1ZXMoaWRlbnRpdGllcywgKGNvaG9ydCkgPT4gcXVlcnlcbiAgICAgIC5jbG9uZSgpXG4gICAgICAud2hlcmUoY29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5Q29ob3J0U3FsKHttb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBxdWVyeSwgdmFsdWVzOiBjb2hvcnR9KSlcbiAgICAgIC50b1NxbCgpKVxuICAgIGNvbnN0IGF1dGhvcml6ZWRJZGVudGl0eUtleXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgY29ob3J0IG9mIGNvaG9ydHMpIHtcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWRNb2RlbHMgPSBhd2FpdCBxdWVyeVxuICAgICAgICAuY2xvbmUoKVxuICAgICAgICAud2hlcmUoY29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5Q29ob3J0U3FsKHttb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBxdWVyeSwgdmFsdWVzOiBjb2hvcnR9KSlcbiAgICAgICAgLnRvQXJyYXkoKVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGF1dGhvcml6ZWRNb2RlbHMpIHtcbiAgICAgICAgY29uc3QgaWRlbnRpdHkgPSByZWFkTW9kZWxQcmltYXJ5S2V5VmFsdWUocHJpbWFyeUtleSwgKGF0dHJpYnV0ZU5hbWUpID0+IG1vZGVsLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG5cbiAgICAgICAgYXV0aG9yaXplZElkZW50aXR5S2V5cy5hZGQobW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgaWRlbnRpdHkpKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBhdXRob3JpemVkSWRlbnRpdHlLZXlzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBmaWx0ZXIgYXV0aG9yaXplZCBtb2RlbHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1wiaW5kZXhcIiB8IFwiZmluZFwiIHwgXCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhcmdzLmFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IGFyZ3MubW9kZWxzIC0gQ2FuZGlkYXRlIG1vZGVscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBBdXRob3JpemVkIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaWx0ZXJBdXRob3JpemVkTW9kZWxzKHthY3Rpb24sIG1vZGVsc30pIHtcbiAgICBpZiAobW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG1vZGVsc1xuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXkoKVxuXG4gICAgY29uc3QgaWRlbnRpdGllcyA9IG1vZGVscy5tYXAoKG1vZGVsKSA9PiB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpKVxuICAgIGNvbnN0IGF1dGhvcml6ZWRJZHMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxBdXRob3JpemVkSWRlbnRpdHlTZXQoe1xuICAgICAgaWRlbnRpdGllcyxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICBwcmltYXJ5S2V5LFxuICAgICAgcXVlcnk6IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShhY3Rpb24pXG4gICAgfSlcblxuICAgIHJldHVybiBtb2RlbHMuZmlsdGVyKChtb2RlbCkgPT4gYXV0aG9yaXplZElkcy5oYXMobW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkocHJpbWFyeUtleSwgdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleVZhbHVlKG1vZGVsKSkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGZyb250ZW5kIG1vZGVsIGJlZm9yZSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciBhY3Rpb24gc2hvdWxkIGNvbnRpbnVlLlxuICAgKi9cbiAgYXN5bmMgcnVuRnJvbnRlbmRNb2RlbEJlZm9yZUFjdGlvbihhY3Rpb24pIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKCkuYmVmb3JlQWN0aW9uKGFjdGlvbilcblxuICAgIHJldHVybiByZXN1bHQgIT09IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBmaW5kIHJlY29yZC5cbiAgICogQHBhcmFtIHtcImZpbmRcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIiB8IFwiYXR0YWNoXCIgfCBcImF0dGFjaG1lbnRMaXN0XCIgfCBcImRvd25sb2FkXCIgfCBcInVybFwifSBhY3Rpb24gLSBGcm9udGVuZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gaWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsPn0gLSBMb2NhdGVkIG1vZGVsIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKGFjdGlvbiwgaWQpIHtcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5maW5kKGFjdGlvbiwgaWQpXG5cbiAgICBpZiAoIW1vZGVsKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgYXV0aG9yaXplZE1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbiwgbW9kZWxzOiBbbW9kZWxdfSlcblxuICAgIHJldHVybiBhdXRob3JpemVkTW9kZWxzWzBdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNyZWF0ZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzIC0gQ3JlYXRlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW25lc3RlZEF0dHJpYnV0ZXNdIC0gT3B0aW9uYWwgbmVzdGVkLWF0dHJpYnV0ZSBwYXlsb2FkIGZvciBjYXNjYWRpbmcgd3JpdGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IFthdHRhY2htZW50c10gLSBPcHRpb25hbCBhdHRhY2htZW50IHBheWxvYWRzIGtleWVkIGJ5IGF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIENyZWF0ZWQgbW9kZWwgd2hlbiBhdXRob3JpemVkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbENyZWF0ZVJlY29yZChhdHRyaWJ1dGVzLCBuZXN0ZWRBdHRyaWJ1dGVzID0gbnVsbCwgYXR0YWNobWVudHMgPSBudWxsKSB7XG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHJlc291cmNlLmNyZWF0ZShhdHRyaWJ1dGVzLCB7YXR0YWNobWVudHMsIG5lc3RlZEF0dHJpYnV0ZXMsIGNvbnRyb2xsZXI6IHRoaXN9KVxuXG4gICAgY29uc3QgYXV0aG9yaXplZE1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbjogXCJjcmVhdGVcIiwgbW9kZWxzOiBbbW9kZWxdfSlcblxuICAgIGlmIChhdXRob3JpemVkTW9kZWxzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhdXRob3JpemVkTW9kZWxzWzBdXG4gICAgfVxuXG4gICAgYXdhaXQgcmVzb3VyY2UuaGFuZGxlVW5hdXRob3JpemVkQ3JlYXRlZE1vZGVsKG1vZGVsKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXT59IC0gRnJvbnRlbmQgbW9kZWwgcmVjb3Jkcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxSZWNvcmRzKCkge1xuICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5yZWNvcmRzKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaWx0ZXJBdXRob3JpemVkTW9kZWxzKHthY3Rpb246IFwiaW5kZXhcIiwgbW9kZWxzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHByZWxvYWQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBudWxsfSAtIEZyb250ZW5kIHByZWxvYWQgZGF0YS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmVsb2FkKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUHJlbG9hZCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5wcmVsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHwgbnVsbH0gLSBGcm9udGVuZCBzZWxlY3QgZGF0YS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxTZWxlY3QoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxTZWxlY3QodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuc2VsZWN0LCB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLmdldE1vZGVsTmFtZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0cyBleHRyYS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiB8IG51bGx9IC0gRnJvbnRlbmQgZXh0cmEtc2VsZWN0IGRhdGEgKGRlZmF1bHRzIHBsdXMgdGhlc2UpLCBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYSgpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlbGVjdCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5zZWxlY3RzRXh0cmEsIHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWFyY2hlcy5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gLSBGcm9udGVuZCBzZWFyY2ggZmlsdGVycy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxTZWFyY2hlcygpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlYXJjaGVzKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnNlYXJjaGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgd2hlcmUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIEZyb250ZW5kIHdoZXJlIGZpbHRlcnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsV2hlcmUoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxXaGVyZSh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS53aGVyZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJhbnNhY2suXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIEZyb250ZW5kIFJhbnNhY2sgZmlsdGVycy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSYW5zYWNrKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmFuc2Fjayh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5yYW5zYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgam9pbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIEZyb250ZW5kIGpvaW5zIGRlc2NyaXB0b3JzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEpvaW5zKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsSm9pbnModGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuam9pbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzb3J0LlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNvcnRbXX0gLSBGcm9udGVuZCBzb3J0IGRlZmluaXRpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNvcnQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBub3JtYWxpemVRdWVyeVNvcnQodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuc29ydClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBncm91cC5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxHcm91cFtdfSAtIEZyb250ZW5kIGdyb3VwIGRlZmluaXRpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEdyb3VwKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUXVlcnlHcm91cCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5ncm91cClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwYWdpbmF0aW9uLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBhZ2luYXRpb259IC0gRnJvbnRlbmQgcGFnaW5hdGlvbiBwYXJhbXMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUGFnaW5hdGlvbigpIHtcbiAgICBjb25zdCBwYXJhbXMgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtcbiAgICAgIGxpbWl0OiBwYXJhbXMubGltaXQsXG4gICAgICBvZmZzZXQ6IHBhcmFtcy5vZmZzZXQsXG4gICAgICBwYWdlOiBwYXJhbXMucGFnZSxcbiAgICAgIHBlclBhZ2U6IHBhcmFtcy5wZXJQYWdlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGRpc3RpbmN0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IG51bGx9IC0gRnJvbnRlbmQgZGlzdGluY3QgZmxhZyB3aGVuIHByb3ZpZGVkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbERpc3RpbmN0KCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsRGlzdGluY3QodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuZGlzdGluY3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwbHVjay5cbiAgICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQbHVja1tdfSAtIEZyb250ZW5kIHBsdWNrIGRlZmluaXRpb25zLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFBsdWNrKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwbHVjayA9IG5vcm1hbGl6ZVF1ZXJ5UGx1Y2sodGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkucGx1Y2spXG5cbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHBsdWNrKVxuXG4gICAgICByZXR1cm4gcGx1Y2tcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb3VudCByZXF1ZXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlcXVlc3QgYXNrcyBmb3IgYW4gYWdncmVnYXRlIGNvdW50LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbENvdW50UmVxdWVzdGVkKCkge1xuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5jb3VudCA9PT0gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgd2l0aCBjb3VudC5cbiAgICogQHJldHVybnMge0FycmF5PHthdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn1cbiAgICogICBGcm9udGVuZCB3aXRoQ291bnQgZW50cmllcy4gRW1wdHkgYXJyYXkgd2hlbiBub3QgcmVxdWVzdGVkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS53aXRoQ291bnRcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIEVudHJpZXMuXG4gICAgICogQHR5cGUge0FycmF5PHthdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmF3KSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIikgY29udGludWVcbiAgICAgIGlmICh0eXBlb2YgZW50cnkuYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5hdHRyaWJ1dGVOYW1lLmxlbmd0aCA9PT0gMCkgY29udGludWVcbiAgICAgIGlmICh0eXBlb2YgZW50cnkucmVsYXRpb25zaGlwTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLmxlbmd0aCA9PT0gMCkgY29udGludWVcblxuICAgICAgZW50cmllcy5wdXNoKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogZW50cnkuYXR0cmlidXRlTmFtZSxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZTogZW50cnkucmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgd2hlcmU6IGVudHJ5LndoZXJlICYmIHR5cGVvZiBlbnRyeS53aGVyZSA9PT0gXCJvYmplY3RcIiA/IGVudHJ5LndoZXJlIDogdW5kZWZpbmVkXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZSBhbiBlbnRyeSBmcm9tIHRoZSBmcm9udGVuZC1tb2RlbCBgYWJpbGl0aWVzYCBwYXlsb2FkIHRvXG4gICAqIGl0cyBiYWNrZW5kIG1vZGVsIGNsYXNzIGJ5IGxvb2tpbmcgdXAgdGhlIHJlc291cmNlIGJ5IG1vZGVsTmFtZVxuICAgKiBhY3Jvc3MgYWxsIGNvbmZpZ3VyZWQgYmFja2VuZCBwcm9qZWN0cy4gUmV0dXJucyBudWxsIHdoZW4gbm9cbiAgICogcmVzb3VyY2UgbWF0Y2hlcyB0aGUgdXNlci1wcm92aWRlZCBhYmlsaXR5IGVudHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gRnJvbnRlbmQgbW9kZWwgbmFtZSBmcm9tIGFuIGFiaWxpdHkgcmVxdWVzdC5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBCYWNrZW5kIG1vZGVsIGNsYXNzIGV4cG9zZWQgdW5kZXIgdGhhdCBmcm9udGVuZCBuYW1lLCBpZiBwcmVzZW50LlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDbGFzc0ZvckFiaWxpdGllcyhtb2RlbE5hbWUpIHtcbiAgICBpZiAodHlwZW9mIG1vZGVsTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBtb2RlbE5hbWUubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGNvbnN0IGZyb250ZW5kTW9kZWxzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gZnJvbnRlbmRNb2RlbHNbbW9kZWxOYW1lXVxuXG4gICAgICBpZiAoIXJlc291cmNlRGVmaW5pdGlvbikgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgICAgaWYgKCFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgJyR7bW9kZWxOYW1lfScgcmVzb3VyY2UgZGVmaW5pdGlvbiBtdXN0IGJlIGEgRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZSBzdWJjbGFzcy5gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzb3VyY2VDbGFzcy5tb2RlbENsYXNzKClcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENvbGxlY3QgZXZlcnkgbG9hZGVkIHJlY29yZCB3aG9zZSBgZ2V0TW9kZWxOYW1lKClgIG1hdGNoZXMgdGhlXG4gICAqIHJlcXVlc3RlZCBuYW1lLCB3YWxraW5nIGFjcm9zcyB0aGUgcm9vdC1sZXZlbCBzbGljZSBwbHVzIGFueVxuICAgKiBwcmVsb2FkZWQgcmVsYXRpb25zaGlwcyBhdCBhbnkgZGVwdGguIFVzZWQgdG8gZXZhbHVhdGUgcGVyLXJlY29yZFxuICAgKiBhYmlsaXRpZXMgYWdhaW5zdCBuZXN0ZWQgcHJlbG9hZGVkIGNoaWxkcmVuIHdpdGggYSBzaW5nbGUgYmF0Y2hlZFxuICAgKiBxdWVyeSBwZXIgKG1vZGVsQ2xhc3MsIGFjdGlvbikgcGFpci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IHJvb3RNb2RlbHMgLSBMb2FkZWQgcm9vdHMgd2hvc2UgcmVsYXRpb25zaGlwIGdyYXBocyBzaG91bGQgYmUgdHJhdmVyc2VkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxOYW1lIC0gTW9kZWwgbmFtZSByZWNvcmRzIG11c3QgbWF0Y2guXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IC0gTWF0Y2hpbmcgcmVjb3JkcyByZWFjaGFibGUgZnJvbSB0aGUgbG9hZGVkIHJvb3RzLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxDb2xsZWN0UmVjb3Jkc0Zvck5hbWUocm9vdE1vZGVscywgbW9kZWxOYW1lKSB7XG4gICAgLyoqXG4gICAgICogT3V0LlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119ICovXG4gICAgY29uc3Qgb3V0ID0gW11cbiAgICAvKipcbiAgICAgKiBTZWVuLlxuICAgICAqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKVxuXG4gICAgLyoqXG4gICAgICogV2Fsay5cbiAgICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsIHwgdW5kZWZpbmVkfSByZWNvcmQgLSBMb2FkZWQgcmVjb3JkIHdob3NlIHJlbGF0aW9uc2hpcCBncmFwaCBzaG91bGQgYmUgdmlzaXRlZC5cbiAgICAgKi9cbiAgICBjb25zdCB3YWxrID0gKHJlY29yZCkgPT4ge1xuICAgICAgaWYgKCFyZWNvcmQgfHwgdHlwZW9mIHJlY29yZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuXG4gICAgICBpZiAoc2Vlbi5oYXMocmVjb3JkKSkgcmV0dXJuXG4gICAgICBzZWVuLmFkZChyZWNvcmQpXG5cbiAgICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZWNvcmQuZ2V0TW9kZWxDbGFzcygpXG4gICAgICBpZiAoTW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSA9PT0gbW9kZWxOYW1lKSB7XG4gICAgICAgIG91dC5wdXNoKHJlY29yZClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwc01hcCA9IE1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBPYmplY3Qua2V5cyhyZWxhdGlvbnNoaXBzTWFwKSkge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGNvbnN0IGxvYWRlZCA9IHJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG4gICAgICAgIGlmIChsb2FkZWQgPT09IHVuZGVmaW5lZCkgY29udGludWVcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSB7XG4gICAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBsb2FkZWQpIHdhbGsoY2hpbGQpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgd2Fsayhsb2FkZWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHJvb3Qgb2Ygcm9vdE1vZGVscykgd2Fsayhyb290KVxuXG4gICAgcmV0dXJuIG91dFxuICB9XG5cbiAgLyoqXG4gICAqIEV2YWx1YXRlIGV2ZXJ5IGFiaWxpdHkgcmVxdWVzdGVkIHZpYSB0aGUgZnJvbnRlbmQgYGFiaWxpdGllc2BcbiAgICogcGFyYW0gYWdhaW5zdCB0aGUgbG9hZGVkIG1vZGVsIGNvaG9ydCAocGx1cyBhbnkgcHJlbG9hZGVkXG4gICAqIGNoaWxkcmVuKSwgYXR0YWNoaW5nIHRoZSByZXN1bHRzIHRvIGVhY2ggcmVjb3JkIHZpYVxuICAgKiBgX3NldENvbXB1dGVkQWJpbGl0eWAuIFJ1bnMgb25lIGJhdGNoZWQgYGF1dGhvcml6ZWQgcXVlcnkgKyBwbHVja2BcbiAgICogcGVyIChtb2RlbENsYXNzLCBhY3Rpb24pIHBhaXIsIHJlZ2FyZGxlc3Mgb2YgaG93IG1hbnkgcmVjb3Jkc1xuICAgKiB3ZXJlIGxvYWRlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IHJvb3RNb2RlbHMgLSBMb2FkZWQgcm9vdHMgdGhhdCByZWNlaXZlIGNvbXB1dGVkIGFiaWxpdHkgcmVzdWx0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhyb290TW9kZWxzKSB7XG4gICAgY29uc3QgZW50cmllcyA9IHRoaXMuZnJvbnRlbmRNb2RlbEFiaWxpdGllcygpXG4gICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocm9vdE1vZGVscykgfHwgcm9vdE1vZGVscy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3QgYWJpbGl0eSA9IHRoaXMuY3VycmVudEFiaWxpdHkoKVxuICAgIGlmICghYWJpbGl0eSkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ2xhc3NGb3JBYmlsaXRpZXMoZW50cnkubW9kZWxOYW1lKVxuICAgICAgaWYgKCFtb2RlbENsYXNzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gdGhpcy5fZnJvbnRlbmRNb2RlbENvbGxlY3RSZWNvcmRzRm9yTmFtZShyb290TW9kZWxzLCBlbnRyeS5tb2RlbE5hbWUpXG4gICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSBtb2RlbENsYXNzLnByaW1hcnlLZXkoKVxuXG4gICAgICBmb3IgKGNvbnN0IGFjdGlvbiBvZiBlbnRyeS5hY3Rpb25zKSB7XG4gICAgICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgICAgIGxldCBhbGxvd2VkSWRzXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYXV0aG9yaXplZFF1ZXJ5ID0gbW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKGFjdGlvbiwgYWJpbGl0eSlcblxuICAgICAgICAgIGNvbnN0IGlkZW50aXRpZXMgPSBjYW5kaWRhdGVzLm1hcCgocmVjb3JkKSA9PiByZWNvcmQuaWQoKSlcblxuICAgICAgICAgIGFsbG93ZWRJZHMgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxBdXRob3JpemVkSWRlbnRpdHlTZXQoe1xuICAgICAgICAgICAgaWRlbnRpdGllcyxcbiAgICAgICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgICAgICBwcmltYXJ5S2V5LFxuICAgICAgICAgICAgcXVlcnk6IGF1dGhvcml6ZWRRdWVyeVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgLy8gQW4gYWJpbGl0eSB3aXRoIG5vIGFsbG93IHJ1bGVzIGZvciB0aGUgYWN0aW9uIHRocm93cyB2aWFcbiAgICAgICAgICAvLyBgYWNjZXNzaWJsZUZvcmA7IHRyZWF0IGFzIGEgdW5pdmVyc2FsIGRlbnkgc28gdGhlIGZyb250ZW5kXG4gICAgICAgICAgLy8gZ2V0cyBgY2FuKGFjdGlvbikgPT09IGZhbHNlYCBmb3IgZXZlcnkgY2FuZGlkYXRlLCBpbnN0ZWFkXG4gICAgICAgICAgLy8gb2Ygc3VyZmFjaW5nIGFuIGVycm9yIHRoYXQgdGhlIFVJIGNhbid0IGFjdCBvbi5cbiAgICAgICAgICB2b2lkIGVycm9yXG4gICAgICAgICAgYWxsb3dlZElkcyA9IG5ldyBTZXQoKVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgY2FuZGlkYXRlcykge1xuICAgICAgICAgIGNvbnN0IGlkVmFsdWUgPSByZWNvcmQuaWQoKVxuICAgICAgICAgIGNvbnN0IGFsbG93ZWQgPSBhbGxvd2VkSWRzLmhhcyhtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZFZhbHVlKSlcbiAgICAgICAgICByZWNvcmQuX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIGFsbG93ZWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2UgdGhlIGZyb250ZW5kLW1vZGVsIGBhYmlsaXRpZXNgIHBhcmFtIGludG8gYSBsaXN0IG9mXG4gICAqIGB7bW9kZWxOYW1lLCBhY3Rpb25zfWAgZW50cmllcyB0byBldmFsdWF0ZSBhZ2FpbnN0IGxvYWRlZCByZWNvcmRzLlxuICAgKiBVbmtub3duIGVudHJpZXMgYXJlIHNpbGVudGx5IHNraXBwZWQg4oCUIGRvd25zdHJlYW0gY29kZSByZXNvbHZlc1xuICAgKiBtb2RlbCBuYW1lcyB0byBjbGFzc2VzIHdoZW4gYXBwbHlpbmcgdGhlIGNoZWNrLCBzbyB1bnJlc29sdmVkXG4gICAqIG5hbWVzIG5hdHVyYWxseSBiZWNvbWUgbm8tb3BzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e21vZGVsTmFtZTogc3RyaW5nLCBhY3Rpb25zOiBzdHJpbmdbXX0+fSAtIE5vcm1hbGl6ZWQgbW9kZWwgYWJpbGl0eSByZXF1ZXN0cy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxBYmlsaXRpZXMoKSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuYWJpbGl0aWVzXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIFtdXG5cbiAgICAvKipcbiAgICAgKiBFbnRyaWVzLlxuICAgICAqIEB0eXBlIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59ICovXG4gICAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJhdykge1xuICAgICAgaWYgKCFlbnRyeSB8fCB0eXBlb2YgZW50cnkgIT09IFwib2JqZWN0XCIpIGNvbnRpbnVlXG4gICAgICBpZiAodHlwZW9mIGVudHJ5Lm1vZGVsTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBlbnRyeS5tb2RlbE5hbWUubGVuZ3RoID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGVudHJ5LmFjdGlvbnMpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBhY3Rpb25zID0gZW50cnkuYWN0aW9ucy5maWx0ZXIoXG4gICAgICAgICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBhY3Rpb24pID0+IHR5cGVvZiBhY3Rpb24gPT09IFwic3RyaW5nXCIgJiYgYWN0aW9uLmxlbmd0aCA+IDBcbiAgICAgIClcblxuICAgICAgaWYgKGFjdGlvbnMubGVuZ3RoID09PSAwKSBjb250aW51ZVxuXG4gICAgICBlbnRyaWVzLnB1c2goe2FjdGlvbnMsIG1vZGVsTmFtZTogZW50cnkubW9kZWxOYW1lfSlcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgdGhlIGZyb250ZW5kLW1vZGVsIGBxdWVyeURhdGFgIHBhcmFtLiBUaGUgd2lyZSBmb3JtYXQgY2Fycmllc1xuICAgKiBvbmx5ICoqbmFtZXMqKiAodGhlIGtleXMgdGhlIGZyb250ZW5kIHdhbnRzIGF0dGFjaGVkKSBwbHVzIHRoZVxuICAgKiBvcHRpb25hbCBuZXN0ZWQtcmVsYXRpb25zaGlwIGNoYWluIGxlYWRpbmcgdG8gdGhlbSDigJQgdGhlIGFjdHVhbCBTUUxcbiAgICogZnJhZ21lbnRzIGxpdmUgb24gdGhlIGJhY2tlbmQgbW9kZWwgYXMgYE1vZGVsLnF1ZXJ5RGF0YShuYW1lLCBmbilgXG4gICAqIHJlZ2lzdHJhdGlvbnMuIENhbGxlcnMgY2Fubm90IHB1c2ggU1FMIHRocm91Z2ggdGhpcyBlbmRwb2ludC5cbiAgICpcbiAgICogUmV0dXJucyB0aGUgcmF3IG5lc3RlZC1yZWNvcmQgc3BlYyAoc2hhcGUgdmFsaWRhdGVkIGJ5IHRoZVxuICAgKiBub3JtYWxpemVyIGluc2lkZSBgUXVlcnkucXVlcnlEYXRhYCkgb3IgYG51bGxgIHdoZW4gbm90IHJlcXVlc3RlZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFTcGVjIHwgbnVsbH0gLSBOb3JtYWxpemVkIHF1ZXJ5LWRhdGEgc3BlY2lmaWNhdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxRdWVyeURhdGEoKSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkucXVlcnlEYXRhXG5cbiAgICBpZiAocmF3ID09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBpZiAodHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHJhd1xuICAgIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiByYXdcbiAgICBpZiAodHlwZW9mIHJhdyA9PT0gXCJvYmplY3RcIikgcmV0dXJuIHJhd1xuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGluZGV4IHF1ZXJ5LlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxJbmRleFF1ZXJ5T3B0aW9uc30gW29wdGlvbnNdIC0gSW5kZXggcXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gLSBGcm9udGVuZCBpbmRleCBxdWVyeSB3aXRoIG5vcm1hbGl6ZWQgcGFyYW1zIGFwcGxpZWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSW5kZXhRdWVyeShvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7aW5jbHVkZVBhZ2luYXRpb24gPSB0cnVlLCBpbmNsdWRlU29ydCA9IHRydWUsIHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpfSA9IG9wdGlvbnNcbiAgICBsZXQgcXVlcnkgPSB0aGlzLmZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoXCJpbmRleFwiKVxuICAgIGNvbnN0IHByZWxvYWQgPSB0aGlzLmZyb250ZW5kTW9kZWxQcmVsb2FkKClcblxuICAgIGlmIChwcmVsb2FkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQocHJlbG9hZClcbiAgICB9XG5cbiAgICBjb25zdCBqb2lucyA9IHRoaXMuZnJvbnRlbmRNb2RlbEpvaW5zKClcbiAgICBjb25zdCB3aGVyZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFdoZXJlKClcbiAgICBjb25zdCBwYWdpbmF0aW9uID0gdGhpcy5mcm9udGVuZE1vZGVsUGFnaW5hdGlvbigpXG4gICAgY29uc3QgZGlzdGluY3QgPSB0aGlzLmZyb250ZW5kTW9kZWxEaXN0aW5jdCgpXG5cbiAgICBpZiAoaW5jbHVkZVBhZ2luYXRpb24pIHtcbiAgICAgIHJlc291cmNlLmFwcGx5RnJvbnRlbmRNb2RlbEluZGV4UGFnaW5hdGlvbih7Y29udHJvbGxlcjogdGhpcywgcGFnaW5hdGlvbiwgcXVlcnl9KVxuICAgIH1cblxuICAgIGlmIChkaXN0aW5jdCAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkuZGlzdGluY3QoZGlzdGluY3QpXG4gICAgfVxuXG4gICAgaWYgKHdoZXJlKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlKHtxdWVyeSwgd2hlcmV9KVxuICAgIH1cblxuICAgIGNvbnN0IHJhbnNhY2sgPSB0aGlzLmZyb250ZW5kTW9kZWxSYW5zYWNrKClcblxuICAgIGlmIChyYW5zYWNrKSB7XG4gICAgICB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrQWxsb3dlZChyYW5zYWNrKVxuICAgICAgcXVlcnkucmFuc2FjayhyYW5zYWNrKVxuICAgIH1cblxuICAgIGlmIChqb2lucykge1xuICAgICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxKb2lucyh7am9pbnMsIHF1ZXJ5fSlcbiAgICB9XG5cbiAgICBjb25zdCBzZWFyY2hlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaGVzKClcblxuICAgIGZvciAoY29uc3Qgc2VhcmNoIG9mIHNlYXJjaGVzKSB7XG4gICAgICByZXNvdXJjZS5hcHBseUZyb250ZW5kTW9kZWxJbmRleFNlYXJjaCh7Y29udHJvbGxlcjogdGhpcywgcXVlcnksIHNlYXJjaH0pXG4gICAgfVxuXG4gICAgY29uc3QgZ3JvdXBzID0gdGhpcy5mcm9udGVuZE1vZGVsR3JvdXAoKVxuXG4gICAgaWYgKGdyb3Vwcy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFJvb3RHcm91cENvbHVtbnMoe3F1ZXJ5fSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxHcm91cCh7Z3JvdXAsIHF1ZXJ5fSlcbiAgICB9XG5cbiAgICBjb25zdCBzb3J0cyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNvcnQoKVxuXG4gICAgaWYgKGluY2x1ZGVTb3J0ICYmIHNvcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3Qgc29ydCBvZiBzb3J0cykge1xuICAgICAgICByZXNvdXJjZS5hcHBseUZyb250ZW5kTW9kZWxJbmRleFNvcnQoe2NvbnRyb2xsZXI6IHRoaXMsIHF1ZXJ5LCBzb3J0fSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB3aXRoQ291bnQgPSB0aGlzLmZyb250ZW5kTW9kZWxXaXRoQ291bnQoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB3aXRoQ291bnQpIHtcbiAgICAgIC8qKlxuICAgICAgICogU3BlYy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwge3JlbGF0aW9uc2hpcD86IHN0cmluZywgd2hlcmU/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gKi9cbiAgICAgIGNvbnN0IHNwZWMgPSB7fVxuICAgICAgc3BlY1tlbnRyeS5hdHRyaWJ1dGVOYW1lXSA9IHtyZWxhdGlvbnNoaXA6IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUsIHdoZXJlOiBlbnRyeS53aGVyZX1cbiAgICAgIHF1ZXJ5LndpdGhDb3VudChzcGVjKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IHRoaXMuZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpXG5cbiAgICBpZiAocXVlcnlEYXRhICE9IG51bGwpIHtcbiAgICAgIHF1ZXJ5LnF1ZXJ5RGF0YShxdWVyeURhdGEpXG4gICAgfVxuXG4gICAgcXVlcnkgPSB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KVxuXG4gICAgaWYgKHF1ZXJ5Ll9kaXN0aW5jdCAmJiBxdWVyeS5kcml2ZXIuZ2V0VHlwZSgpID09PSBcIm1zc3FsXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxNc3NxbERpc3RpbmN0QnlQcmltYXJ5S2V5UXVlcnkoe3F1ZXJ5fSlcbiAgICB9XG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBNU1NRTCBjYW5ub3QgYXBwbHkgRElTVElOQ1Qgb3ZlciBub24tY29tcGFyYWJsZSB0ZXh0IGNvbHVtbnMgaW4gdGFibGUuKiBzZWxlY3RzLlxuICAgKiBUaGlzIHJld3JpdGVzIGRpc3RpbmN0IGZyb250ZW5kLW1vZGVsIHF1ZXJpZXMgdG8gc2VsZWN0IHJvb3QgcmVjb3JkcyBieSBkaXN0aW5jdCBQSyBzdWJxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IHdpdGggZGlzdGluY3QgYW5kIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IC0gTVNTUUwtc2FmZSBkaXN0aW5jdCBxdWVyeS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxNc3NxbERpc3RpbmN0QnlQcmltYXJ5S2V5UXVlcnkoe3F1ZXJ5fSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShtb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgXCJNU1NRTCBkaXN0aW5jdCBmcm9udGVuZC1tb2RlbCBxdWVyaWVzXCIpXG4gICAgY29uc3Qgcm9vdFRhYmxlU3FsID0gcXVlcnkuZHJpdmVyLnF1b3RlVGFibGUobW9kZWxDbGFzcy50YWJsZU5hbWUoKSlcbiAgICBjb25zdCBwcmltYXJ5S2V5U3FsID0gYCR7cm9vdFRhYmxlU3FsfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KX1gXG4gICAgY29uc3QgZGlzdGluY3RJZHNRdWVyeSA9IHF1ZXJ5LmNsb25lKClcblxuICAgIGRpc3RpbmN0SWRzUXVlcnkuX3ByZWxvYWQgPSB7fVxuICAgIGRpc3RpbmN0SWRzUXVlcnkuX3NlbGVjdHMgPSBbXVxuICAgIGRpc3RpbmN0SWRzUXVlcnkuc2VsZWN0KHByaW1hcnlLZXlTcWwpXG4gICAgZGlzdGluY3RJZHNRdWVyeS5kaXN0aW5jdCh0cnVlKVxuXG4gICAgY29uc3QgZGlzdGluY3RSb290UXVlcnkgPSBtb2RlbENsYXNzLl9uZXdRdWVyeSgpXG5cbiAgICBkaXN0aW5jdFJvb3RRdWVyeS53aGVyZShgJHtwcmltYXJ5S2V5U3FsfSBJTiAoJHtkaXN0aW5jdElkc1F1ZXJ5LnRvU3FsKCl9KWApXG4gICAgZGlzdGluY3RSb290UXVlcnkuX3ByZWxvYWQgPSB7Li4ucXVlcnkuX3ByZWxvYWR9XG5cbiAgICByZXR1cm4gZGlzdGluY3RSb290UXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBsdWNrIHZhbHVlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQbHVjayBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQbHVja1tdfSBhcmdzLnBsdWNrIC0gUGx1Y2sgZGVzY3JpcHRvcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGx1Y2tlZCB2YWx1ZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsUGx1Y2tWYWx1ZXMoe3F1ZXJ5LCBwbHVja30pIHtcbiAgICBpZiAocGx1Y2subGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29sdW1ucyBnaXZlbiB0byBwbHVja1wiKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgcGx1Y2tRdWVyeSA9IHF1ZXJ5LmNsb25lKClcbiAgICAvKipcbiAgICAgKiBBbGlhc2VzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBhbGlhc2VzID0gW11cbiAgICBjb25zdCBxdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpXG4gICAgY29uc3QgcGx1Y2tRdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocGx1Y2tRdWVyeSlcbiAgICBjb25zdCBqb2luZWRQYXRocyA9IHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXVxuXG4gICAgcGx1Y2tRdWVyeS5fcHJlbG9hZCA9IHt9XG4gICAgcGx1Y2tRdWVyeS5fc2VsZWN0cyA9IFtdXG4gICAgcGx1Y2tRdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gPSBqb2luZWRQYXRocyA/IG5ldyBTZXQoam9pbmVkUGF0aHMpIDogbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IFtwbHVja0luZGV4LCBwbHVja0VudHJ5XSBvZiBwbHVjay5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgcGF0aDogcGx1Y2tFbnRyeS5wYXRoXG4gICAgICB9KVxuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxRdWVyeWFibGVDb2x1bW5OYW1lKHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogcGx1Y2tFbnRyeS5jb2x1bW4sXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IFwicGx1Y2tcIlxuICAgICAgfSlcblxuICAgICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHBsdWNrIGNvbHVtbiBcIiR7cGx1Y2tFbnRyeS5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGlmIChwbHVja0VudHJ5LnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aDogcGx1Y2tFbnRyeS5wYXRoLCBxdWVyeTogcGx1Y2tRdWVyeX0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gcGx1Y2tRdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGx1Y2tFbnRyeS5wYXRoKVxuICAgICAgY29uc3QgY29sdW1uU3FsID0gYCR7cGx1Y2tRdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cGx1Y2tRdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuICAgICAgY29uc3QgYWxpYXMgPSBgZnJvbnRlbmRfbW9kZWxfcGx1Y2tfJHtwbHVja0luZGV4fWBcblxuICAgICAgcGx1Y2tRdWVyeS5zZWxlY3QoYCR7Y29sdW1uU3FsfSBBUyAke3BsdWNrUXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGFsaWFzKX1gKVxuICAgICAgYWxpYXNlcy5wdXNoKGFsaWFzKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBwbHVja1F1ZXJ5LnJlc3VsdHMoKVxuXG4gICAgaWYgKGFsaWFzZXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBbYWxpYXNdID0gYWxpYXNlc1xuXG4gICAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpW2FsaWFzXSlcbiAgICB9XG5cbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgY29uc3Qgcm93SGFzaCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocm93KVxuXG4gICAgICByZXR1cm4gYWxpYXNlcy5tYXAoKGFsaWFzKSA9PiByb3dIYXNoW2FsaWFzXSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZnJvbnRlbmQtbW9kZWwgcGx1Y2sgYXR0cmlidXRlIHRvIGEgZGF0YWJhc2UgY29sdW1uLlxuICAgKiBAcGFyYW0ge3thdHRyaWJ1dGVOYW1lOiBzdHJpbmcsIG1vZGVsQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gUmVzb2x2ZWQgREIgY29sdW1uIG5hbWUuXG4gICAqL1xuICByZXNvbHZlRnJvbnRlbmRNb2RlbFBsdWNrQ29sdW1uTmFtZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZXMgJiYgIWF0dHJpYnV0ZU5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBvc2VkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGF0dHJpYnV0ZSBuYW1lcyBmb3IgYSBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz4gfCBudWxsfSBFeHBvc2VkIHJlc291cmNlIGF0dHJpYnV0ZSBuYW1lcywgb3IgbnVsbCB3aGVuIHRoZSByZXNvdXJjZSBleHBvc2VzIGFsbCBEQi1iYWNrZWQgbW9kZWwgYXR0cmlidXRlcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZU5hbWVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVybiBuZXcgU2V0KClcblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXNcblxuICAgIGlmICghYXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVOYW1lcyhhdHRyaWJ1dGVzKVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWVzLnNpemUgPCAxKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBleHBvc2VkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbltcImF0dHJpYnV0ZXNcIl19IGF0dHJpYnV0ZXMgLSBSZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IEV4cG9zZWQgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXMoYXR0cmlidXRlcykge1xuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBuZXcgU2V0KClcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgYXR0cmlidXRlTmFtZXMuYWRkKGF0dHJpYnV0ZSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXR0cmlidXRlQ29uZmlnID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUNvbmZpZ3VyYXRpb259ICovIChhdHRyaWJ1dGUpXG5cbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVDb25maWcubmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBhdHRyaWJ1dGVDb25maWcubmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYXR0cmlidXRlIGFycmF5IGVudHJpZXMgbXVzdCBiZSBzdHJpbmdzIG9yIGNvbmZpZ3Mgd2l0aCBhIG5hbWUuXCIpXG4gICAgICAgIH1cblxuICAgICAgICBhdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlQ29uZmlnLm5hbWUpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhdHRyaWJ1dGVOYW1lc1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydHMgZnJvbnRlbmQtbW9kZWwgcGx1Y2sgZGVmaW5pdGlvbnMgb25seSByZWZlcmVuY2UgZXhwb3NlZCByZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQbHVja1tdfSBwbHVjayAtIFBsdWNrIGRlc2NyaXB0b3JzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxQbHVja0RlZmluaXRpb25zQWxsb3dlZChwbHVjaykge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG5cbiAgICBmb3IgKGNvbnN0IHBsdWNrRW50cnkgb2YgcGx1Y2spIHtcbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgcGF0aDogcGx1Y2tFbnRyeS5wYXRoXG4gICAgICB9KVxuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxQbHVja0NvbHVtbk5hbWUoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBwbHVja0VudHJ5LmNvbHVtbixcbiAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzc1xuICAgICAgfSlcblxuICAgICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHBsdWNrIGNvbHVtbiBcIiR7cGx1Y2tFbnRyeS5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydHMgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBkZWZpbml0aW9ucyBvbmx5IHJlZmVyZW5jZSBleHBvc2VkIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByYW5zYWNrIC0gUmFuc2FjayBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrQWxsb3dlZChyYW5zYWNrKSB7XG4gICAgY29uc3Qge3MsIC4uLmZpbHRlclBhcmFtc30gPSByYW5zYWNrXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoZmlsdGVyUGFyYW1zKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrR3JvdXBBbGxvd2VkKHtcbiAgICAgICAgZ3JvdXA6IHRoaXMuZnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cChmaWx0ZXJQYXJhbXMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcyA9PT0gXCJzdHJpbmdcIiAmJiBzLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGNvbnN0IHNvcnQgb2YgdGhpcy5mcm9udGVuZE1vZGVsUmFuc2Fja1NvcnRzKHMpKSB7XG4gICAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBdHRyaWJ1dGVBbGxvd2VkKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBzb3J0LmF0dHJpYnV0ZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IFwicmFuc2FjayBzb3J0XCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemVkIGZyb250ZW5kLW1vZGVsIFJhbnNhY2sgZ3JvdXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBmaWx0ZXJQYXJhbXMgLSBSYW5zYWNrIGZpbHRlciBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3V0aWxzL3JhbnNhY2suanNcIikuUmFuc2Fja0dyb3VwfSBOb3JtYWxpemVkIFJhbnNhY2sgZ3JvdXAuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmFuc2Fja0dyb3VwKGZpbHRlclBhcmFtcykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gbm9ybWFsaXplUmFuc2Fja0dyb3VwKHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksIGZpbHRlclBhcmFtcylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemVkIGZyb250ZW5kLW1vZGVsIFJhbnNhY2sgc29ydHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzb3J0U3RyaW5nIC0gUmFuc2FjayBzb3J0IHN0cmluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrU29ydFtdfSBOb3JtYWxpemVkIFJhbnNhY2sgc29ydHMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmFuc2Fja1NvcnRzKHNvcnRTdHJpbmcpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHBhcnNlUmFuc2Fja1NvcnQodGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSwgc29ydFN0cmluZylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBhIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBncm91cCBvbmx5IHJlZmVyZW5jZXMgZXhwb3NlZCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFzc2VydGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrR3JvdXB9IGFyZ3MuZ3JvdXAgLSBSYW5zYWNrIGdyb3VwLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrR3JvdXBBbGxvd2VkKHtncm91cH0pIHtcbiAgICBmb3IgKGNvbnN0IGNvbmRpdGlvbiBvZiBncm91cC5jb25kaXRpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZSBvZiBjb25kaXRpb24uYXR0cmlidXRlcykge1xuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSxcbiAgICAgICAgICBwYXRoOiBhdHRyaWJ1dGUucGF0aFxuICAgICAgICB9KVxuXG4gICAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBdHRyaWJ1dGVBbGxvd2VkKHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lOiBhdHRyaWJ1dGUuYXR0cmlidXRlTmFtZSxcbiAgICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICAgIG9wZXJhdGlvbk5hbWU6IFwicmFuc2Fja1wiXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBncm91cGluZyBvZiBncm91cC5ncm91cGluZ3MpIHtcbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cEFsbG93ZWQoe2dyb3VwOiBncm91cGluZ30pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFzc2VydHMgb25lIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBhdHRyaWJ1dGUgaXMgZXhwb3NlZCBieSBpdHMgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzZXJ0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5vcGVyYXRpb25OYW1lIC0gT3BlcmF0aW9uIG5hbWUgZm9yIGVycm9ycy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0F0dHJpYnV0ZUFsbG93ZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbk5hbWV9KSB7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZU5hbWVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWVzICYmICFhdHRyaWJ1dGVOYW1lcy5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duICR7b3BlcmF0aW9uTmFtZX0gYXR0cmlidXRlIFwiJHthdHRyaWJ1dGVOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHNlYXJjaCB0YXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIFJvb3QgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe21vZGVsQ2xhc3MsIHBhdGh9KSB7XG4gICAgbGV0IHRhcmdldE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgb2YgcGF0aCkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gc2VhcmNoIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwVGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX0jJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzXG4gICAgfVxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHNlYXJjaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsU2VhcmNofSBhcmdzLnNlYXJjaCAtIFNlYXJjaCBmaWx0ZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsU2VhcmNoKHtxdWVyeSwgc2VhcmNofSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIHBhdGg6IHNlYXJjaC5wYXRoXG4gICAgfSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgYXR0cmlidXRlTmFtZTogc2VhcmNoLmNvbHVtbixcbiAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICBvcGVyYXRpb25OYW1lOiBcInNlYXJjaFwiXG4gICAgfSlcblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gc2VhcmNoIGNvbHVtbiBcIiR7c2VhcmNoLmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoc2VhcmNoLnBhdGgubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGg6IHNlYXJjaC5wYXRoLCBxdWVyeX0pXG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4uc2VhcmNoLnBhdGgpXG4gICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG4gICAgY29uc3Qgb3BlcmF0b3JNYXAgPSB7XG4gICAgICBlcTogXCI9XCIsXG4gICAgICBndDogXCI+XCIsXG4gICAgICBndGVxOiBcIj49XCIsXG4gICAgICBsaWtlOiBcIkxJS0VcIixcbiAgICAgIGx0OiBcIjxcIixcbiAgICAgIGx0ZXE6IFwiPD1cIixcbiAgICAgIG5vdEVxOiBcIiE9XCJcbiAgICB9XG4gICAgY29uc3Qgc3FsT3BlcmF0b3IgPSBvcGVyYXRvck1hcFtzZWFyY2gub3BlcmF0b3JdXG5cbiAgICBpZiAoc2VhcmNoLm9wZXJhdG9yID09PSBcImVxXCIpIHtcbiAgICAgIGlmICh0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEFycmF5U2VhcmNoKHtlbXB0eVNxbDogXCIxPTBcIiwgb3BlcmF0b3JTcWw6IFwiSU5cIiwgcXVlcnksIHNlYXJjaCwgY29sdW1uU3FsfSkpIHJldHVyblxuXG4gICAgICBpZiAoc2VhcmNoLnZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gSVMgTlVMTGApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzZWFyY2gub3BlcmF0b3IgPT09IFwibm90RXFcIikge1xuICAgICAgaWYgKHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsQXJyYXlTZWFyY2goe2VtcHR5U3FsOiBcIjE9MVwiLCBvcGVyYXRvclNxbDogXCJOT1QgSU5cIiwgcXVlcnksIHNlYXJjaCwgY29sdW1uU3FsfSkpIHJldHVyblxuXG4gICAgICBpZiAoc2VhcmNoLnZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gSVMgTk9UIE5VTExgKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9ICR7c3FsT3BlcmF0b3J9ICR7cXVlcnkuZHJpdmVyLnF1b3RlKHNlYXJjaC52YWx1ZSl9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBseSBhcnJheS12YWx1ZWQgZXF1YWxpdHkgc2VhcmNoIGZpbHRlcnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU2VhcmNoIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uU3FsIC0gU1FMIGZvciB0aGUgc2VhcmNoZWQgY29sdW1uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5lbXB0eVNxbCAtIFNRTCBwcmVkaWNhdGUgdXNlZCB3aGVuIHRoZSBhcnJheSBpcyBlbXB0eS5cbiAgICogQHBhcmFtIHtcIklOXCIgfCBcIk5PVCBJTlwifSBhcmdzLm9wZXJhdG9yU3FsIC0gU1FMIGFycmF5IG9wZXJhdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW4gYXJyYXkgcHJlZGljYXRlIHdhcyBhcHBsaWVkLlxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsQXJyYXlTZWFyY2goe2NvbHVtblNxbCwgZW1wdHlTcWwsIG9wZXJhdG9yU3FsLCBxdWVyeSwgc2VhcmNofSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShzZWFyY2gudmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChzZWFyY2gudmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICBxdWVyeS53aGVyZShlbXB0eVNxbClcbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSAke29wZXJhdG9yU3FsfSAoJHtzZWFyY2gudmFsdWUubWFwKChlbnRyeSkgPT4gcXVlcnkuZHJpdmVyLnF1b3RlKGVudHJ5KSkuam9pbihcIiwgXCIpfSlgKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCBwYWdpbmF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2luYXRpb24gYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsUGFnaW5hdGlvbn0gYXJncy5wYWdpbmF0aW9uIC0gUGFnaW5hdGlvbiB2YWx1ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsUGFnaW5hdGlvbih7cXVlcnksIHBhZ2luYXRpb259KSB7XG4gICAgaWYgKHBhZ2luYXRpb24ubGltaXQgIT09IG51bGwpIHtcbiAgICAgIHF1ZXJ5LmxpbWl0KHBhZ2luYXRpb24ubGltaXQpXG4gICAgfVxuXG4gICAgaWYgKHBhZ2luYXRpb24ub2Zmc2V0ICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5vZmZzZXQocGFnaW5hdGlvbi5vZmZzZXQpXG4gICAgfVxuXG4gICAgaWYgKHBhZ2luYXRpb24ucGVyUGFnZSAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkucGVyUGFnZShwYWdpbmF0aW9uLnBlclBhZ2UpXG4gICAgfVxuXG4gICAgaWYgKHBhZ2luYXRpb24ucGFnZSAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkucGFnZShwYWdpbmF0aW9uLnBhZ2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgd2hlcmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2hlcmUgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mud2hlcmUgLSBSb290LW1vZGVsIHdoZXJlIGNvbmRpdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pIHtcbiAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlRm9yUGF0aCh7XG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgcGF0aDogW10sXG4gICAgICBxdWVyeSxcbiAgICAgIHdoZXJlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIGpvaW5zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW5zIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmpvaW5zIC0gUmVsYXRpb25zaGlwLW9iamVjdCBqb2lucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxKb2lucyh7am9pbnMsIHF1ZXJ5fSkge1xuICAgIGNvbnN0IGpvaW5QYXRoS2V5cyA9IG5ldyBTZXQoKVxuXG4gICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxKb2luc0ZvclBhdGgoe1xuICAgICAgam9pbnMsXG4gICAgICBqb2luUGF0aEtleXMsXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgcGF0aDogW10sXG4gICAgICBxdWVyeVxuICAgIH0pXG5cbiAgICBxdWVyeS5qb2lucyhqb2lucylcblxuICAgIGNvbnN0IHF1ZXJ5TWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShxdWVyeSlcbiAgICBjb25zdCBqb2luZWRQYXRocyA9IHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXSB8fCBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3Qgam9pblBhdGhLZXkgb2Ygam9pblBhdGhLZXlzKSB7XG4gICAgICBqb2luZWRQYXRocy5hZGQoam9pblBhdGhLZXkpXG4gICAgfVxuXG4gICAgcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdID0gam9pbmVkUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIGpvaW5zIGZvciBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW5zIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmpvaW5zIC0gSm9pbnMgZm9yIGN1cnJlbnQgcGF0aC5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gYXJncy5qb2luUGF0aEtleXMgLSBKb2luZWQgcGF0aCBrZXlzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyBmb3IgY3VycmVudCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxKb2luc0ZvclBhdGgoe2pvaW5zLCBqb2luUGF0aEtleXMsIG1vZGVsQ2xhc3MsIHBhdGgsIHF1ZXJ5fSkge1xuICAgIHZvaWQgcXVlcnlcblxuICAgIGZvciAoY29uc3QgW3JlbGF0aW9uc2hpcE5hbWUsIHJlbGF0aW9uc2hpcEpvaW5dIG9mIE9iamVjdC5lbnRyaWVzKGpvaW5zKSkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gam9pbiByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHRhcmdldCBtb2RlbCBjbGFzcyBmb3Igam9pbiByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgb24gJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwUGF0aCA9IFsuLi5wYXRoLCByZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgam9pblBhdGhLZXlzLmFkZChyZWxhdGlvbnNoaXBQYXRoLmpvaW4oXCIuXCIpKVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwSm9pbiA9PT0gdHJ1ZSkgY29udGludWVcblxuICAgICAgdGhpcy5hcHBseUZyb250ZW5kTW9kZWxKb2luc0ZvclBhdGgoe1xuICAgICAgICBqb2luczogcmVsYXRpb25zaGlwSm9pbixcbiAgICAgICAgam9pblBhdGhLZXlzLFxuICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICBwYXRoOiByZWxhdGlvbnNoaXBQYXRoLFxuICAgICAgICBxdWVyeVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBleHBvc2VkIGF0dHJpYnV0ZSBuYW1lcyBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+IHwgbnVsbH0gLSBFeHBvc2VkIGF0dHJpYnV0ZSBuYW1lcywgb3IgbnVsbCB3aGVuIG5vIHJlc291cmNlIG1ldGFkYXRhIGlzIGF2YWlsYWJsZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxFeHBvc2VkQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZT8ucmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXNcblxuICAgIGlmICghYXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IGF0dHJpYnV0ZXNcbiAgICAgICAgLm1hcCgoZW50cnkpID0+IHtcbiAgICAgICAgICBpZiAodHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKSByZXR1cm4gZW50cnlcbiAgICAgICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGxcblxuICAgICAgICAgIGNvbnN0IG5hbWUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KS5uYW1lXG5cbiAgICAgICAgICByZXR1cm4gdHlwZW9mIG5hbWUgPT09IFwic3RyaW5nXCIgJiYgbmFtZS5sZW5ndGggPiAwID8gbmFtZSA6IG51bGxcbiAgICAgICAgfSlcbiAgICAgICAgLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIilcblxuICAgICAgaWYgKGF0dHJpYnV0ZU5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcblxuICAgICAgcmV0dXJuIG5ldyBTZXQoYXR0cmlidXRlTmFtZXMpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gbmV3IFNldChPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgZnJvbnRlbmQtc3VwcGxpZWQga2V5IHRvIGl0cyBjYW5vbmljYWwgbW9kZWwgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEZyb250ZW5kIGtleSBvciByYXcgY29sdW1uIGtleS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVGb3JLZXkobW9kZWxDbGFzcywga2V5KSB7XG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShrZXkpXG5cbiAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXG5cbiAgICBjb25zdCBjb2x1bW5BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClba2V5XVxuXG4gICAgcmV0dXJuIGNvbHVtbkF0dHJpYnV0ZU5hbWUgfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIGZyb250ZW5kLXN1cHBsaWVkIGF0dHJpYnV0ZSBpcyBleHBvc2VkIGJ5IHRoZSByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gUmVxdWVzdGVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVzb3VyY2UgcGVybWl0cyB0aGUgYXR0cmlidXRlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUlzRXhwb3NlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pIHtcbiAgICBjb25zdCBleHBvc2VkQXR0cmlidXRlTmFtZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxFeHBvc2VkQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWV4cG9zZWRBdHRyaWJ1dGVOYW1lcykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBleHBvc2VkQXR0cmlidXRlTmFtZXMuaGFzKGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBhIHNlbGVjdGVkIGZyb250ZW5kLW1vZGVsIGF0dHJpYnV0ZSBsaXN0IG9ubHkgcmVmZXJlbmNlcyBleHBvc2VkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5hdHRyaWJ1dGVOYW1lcyAtIFNlbGVjdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7XCJzZWxlY3RcIiB8IFwic2VsZWN0c0V4dHJhXCJ9IGFyZ3Mub3BlcmF0aW9uTmFtZSAtIFNlbGVjdGlvbiBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBBbGxvd2VkIHNlbGVjdGVkIGF0dHJpYnV0ZSBuYW1lcy5cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNBbGxvd2VkKHthdHRyaWJ1dGVOYW1lcywgbW9kZWxDbGFzcywgb3BlcmF0aW9uTmFtZX0pIHtcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgIGlmICh0aGlzLmZyb250ZW5kTW9kZWxBdHRyaWJ1dGVJc0V4cG9zZWQoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3N9KSkgY29udGludWVcblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gJHtvcGVyYXRpb25OYW1lfSBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSB1c2VyLXF1ZXJ5YWJsZSBmcm9udGVuZCBhdHRyaWJ1dGUgdG8gYSBkYXRhYmFzZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIFJlcXVlc3RlZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7XCJncm91cFwiIHwgXCJwbHVja1wiIHwgXCJzZWFyY2hcIiB8IFwic29ydFwiIHwgXCJ3aGVyZVwifSBhcmdzLm9wZXJhdGlvbk5hbWUgLSBRdWVyeSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVzb2x2ZWQgY29sdW1uIG5hbWUuXG4gICAqL1xuICByZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe2F0dHJpYnV0ZU5hbWUsIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbk5hbWV9KSB7XG4gICAgdm9pZCBvcGVyYXRpb25OYW1lXG5cbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSB0aGlzLmZyb250ZW5kTW9kZWxBdHRyaWJ1dGVOYW1lRm9yS2V5KG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lICYmICF0aGlzLmZyb250ZW5kTW9kZWxBdHRyaWJ1dGVJc0V4cG9zZWQoe2F0dHJpYnV0ZU5hbWU6IHJlc29sdmVkQXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBrZXkgdGhhdCBtYXkgYmUgZWl0aGVyIGEgY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lIG9yIGEgcmF3IERCXG4gICAqIGNvbHVtbiBuYW1lIHRvIGl0cyBjYW5vbmljYWwgY29sdW1uIG5hbWUuICBSZXR1cm5zIGB1bmRlZmluZWRgIHdoZW4gdGhlXG4gICAqIGtleSBtYXRjaGVzIG5laXRoZXIgbWFwLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBBdHRyaWJ1dGUgbmFtZSBvciBjb2x1bW4gbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFJlc29sdmVkIERCIGNvbHVtbiBuYW1lLCBvciBgdW5kZWZpbmVkYC5cbiAgICovXG4gIHJlc29sdmVGcm9udGVuZE1vZGVsQ29sdW1uTmFtZShtb2RlbENsYXNzLCBrZXkpIHtcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGtleSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG5cbiAgICAvLyBGYWxsIGJhY2s6IHRoZSBrZXkgbWF5IGFscmVhZHkgYmUgYSByYXcgREIgY29sdW1uIG5hbWUgbm90IHByZXNlbnQgaW4gdGhlIGF0dHJpYnV0ZSBtYXAuXG4gICAgaWYgKG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2tleV0pIHJldHVybiBrZXlcblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHdoZXJlIGZvciBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFdoZXJlIGFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGZvciBjdXJyZW50IHdoZXJlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aCBmcm9tIHJvb3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLndoZXJlIC0gV2hlcmUgY29uZGl0aW9ucyBmb3IgY3VycmVudCBzY29wZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxXaGVyZUZvclBhdGgoe21vZGVsQ2xhc3MsIHBhdGgsIHF1ZXJ5LCB3aGVyZX0pIHtcbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMod2hlcmUpKSB7XG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lLFxuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBvcGVyYXRpb25OYW1lOiBcIndoZXJlXCJcbiAgICAgIH0pXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoLCBxdWVyeX0pXG5cbiAgICAgICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aClcbiAgICAgICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgaWYgKHZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcXVlcnkud2hlcmUoXCIxPTBcIilcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlcyA9IHZhbHVlLm1hcCgoZW50cnkpID0+IHRoaXMubm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlQ29sdW1uVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlOiBlbnRyeX0pKVxuXG4gICAgICAgICAgICBpZiAobm9ybWFsaXplZFZhbHVlcy5pbmNsdWRlcyhmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sKSkge1xuICAgICAgICAgICAgICBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSBJTiAoJHtub3JtYWxpemVkVmFsdWVzLm1hcCgoZW50cnkpID0+IHF1ZXJ5LmRyaXZlci5xdW90ZShlbnRyeSkpLmpvaW4oXCIsIFwiKX0pYClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICAgICAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9IElTIE5VTExgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMubm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlQ29sdW1uVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlfSlcblxuICAgICAgICAgIGlmIChub3JtYWxpemVkVmFsdWUgPT09IGZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hTeW1ib2wpIHtcbiAgICAgICAgICAgIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gPSAke3F1ZXJ5LmRyaXZlci5xdW90ZShub3JtYWxpemVkVmFsdWUpfWApXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biB3aGVyZSByZWxhdGlvbnNoaXAgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciB3aGVyZSByZWxhdGlvbnNoaXAgXCIke2F0dHJpYnV0ZU5hbWV9XCIgb24gJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcFBhdGggPSBbLi4ucGF0aCwgYXR0cmlidXRlTmFtZV1cblxuICAgICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlRm9yUGF0aCh7XG4gICAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgICAgICBwYXRoOiByZWxhdGlvbnNoaXBQYXRoLFxuICAgICAgICAgIHF1ZXJ5LFxuICAgICAgICAgIHdoZXJlOiB2YWx1ZVxuICAgICAgICB9KVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHdoZXJlIGNvbHVtbiBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgd2hlcmUgY29sdW1uIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBXaGVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgc3ltYm9sfSAtIFNRTC1zYWZlIHdoZXJlIHZhbHVlLlxuICAgKi9cbiAgbm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlQ29sdW1uVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlfSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSk/LnRvTG93ZXJDYXNlKClcbiAgICAgIGNvbnN0IGlzRGF0ZVRpbWVDb2x1bW4gPSB0eXBlb2YgY29sdW1uVHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBbXCJkYXRlXCIsIFwiZGF0ZXRpbWVcIiwgXCJ0aW1lc3RhbXBcIl0uc29tZSgodHlwZSkgPT4gY29sdW1uVHlwZS5pbmNsdWRlcyh0eXBlKSlcblxuICAgICAgaWYgKGlzRGF0ZVRpbWVDb2x1bW4pIHtcbiAgICAgICAgY29uc3QgcGFyc2VkRGF0ZSA9IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSl9KVxuXG4gICAgICAgIGlmIChpc0RhdGUocGFyc2VkRGF0ZSkpIHtcbiAgICAgICAgICByZXR1cm4gcGFyc2VkRGF0ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICAgIGlmICh0eXBlb2YgY29sdW1uVHlwZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbFxuICAgICAgfVxuXG4gICAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKVxuICAgICAgY29uc3Qgb2JqZWN0VmFsdWVUeXBlcyA9IG5ldyBTZXQoW1wiY2hhclwiLCBcInZhcmNoYXJcIiwgXCJudmFyY2hhclwiLCBcInN0cmluZ1wiLCBcImVudW1cIiwgXCJqc29uXCIsIFwianNvbmJcIiwgXCJjaXRleHRcIiwgXCJiaW5hcnlcIiwgXCJ2YXJiaW5hcnlcIl0pXG4gICAgICBjb25zdCBzdXBwb3J0c09iamVjdFZhbHVlcyA9IG5vcm1hbGl6ZWRUeXBlLmluY2x1ZGVzKFwidGV4dFwiKSB8fCBvYmplY3RWYWx1ZVR5cGVzLmhhcyhub3JtYWxpemVkVHlwZSlcblxuICAgICAgaWYgKCFzdXBwb3J0c09iamVjdFZhbHVlcykge1xuICAgICAgICByZXR1cm4gZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCBncm91cC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBHcm91cCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxHcm91cH0gYXJncy5ncm91cCAtIEdyb3VwIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsR3JvdXAoe3F1ZXJ5LCBncm91cH0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBwYXRoOiBncm91cC5wYXRoXG4gICAgfSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgYXR0cmlidXRlTmFtZTogZ3JvdXAuY29sdW1uLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwiZ3JvdXBcIlxuICAgIH0pXG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIGdyb3VwIGNvbHVtbiBcIiR7Z3JvdXAuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoOiBncm91cC5wYXRoLCBxdWVyeX0pXG5cbiAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5ncm91cC5wYXRoKVxuICAgIGNvbnN0IGNvbHVtblNxbCA9IGAke3F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHRhYmxlUmVmZXJlbmNlKX0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuXG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsR3JvdXBDb2x1bW4oe2NvbHVtblNxbCwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgcm9vdC1tb2RlbCBjb2x1bW5zIHRvIEdST1VQIEJZIHNvIHN0cmljdCBTUUwgZW5naW5lcyBhY2NlcHQgZGVmYXVsdCByb290LXRhYmxlIHNlbGVjdHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxSb290R3JvdXBDb2x1bW5zKHtxdWVyeX0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHJvb3RUYWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbk5hbWUgb2YgT2JqZWN0LnZhbHVlcyhhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSkge1xuICAgICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUocm9vdFRhYmxlUmVmZXJlbmNlKX0uJHtxdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9YFxuXG4gICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxHcm91cENvbHVtbih7Y29sdW1uU3FsLCBxdWVyeX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYSBncm91cC1ieSBTUUwgY29sdW1uIGlzIG9ubHkgYXBwZW5kZWQgb25jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5TcWwgLSBGdWxseS1xdWFsaWZpZWQgY29sdW1uIFNRTC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnN1cmVGcm9udGVuZE1vZGVsR3JvdXBDb2x1bW4oe2NvbHVtblNxbCwgcXVlcnl9KSB7XG4gICAgY29uc3QgcXVlcnlNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KVxuICAgIGNvbnN0IGdyb3VwZWRDb2x1bW5zID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsR3JvdXBlZENvbHVtbnNTeW1ib2xdIHx8IG5ldyBTZXQoKVxuXG4gICAgaWYgKGdyb3VwZWRDb2x1bW5zLmhhcyhjb2x1bW5TcWwpKSByZXR1cm5cblxuICAgIHF1ZXJ5Lmdyb3VwKGNvbHVtblNxbClcbiAgICBncm91cGVkQ29sdW1ucy5hZGQoY29sdW1uU3FsKVxuICAgIHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEdyb3VwZWRDb2x1bW5zU3ltYm9sXSA9IGdyb3VwZWRDb2x1bW5zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCB0cmFuc2xhdGVkIGF0dHJpYnV0ZSBwcmVsb2Fkcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gUXVlcnkgd2l0aCB0cmFuc2xhdGlvbnMgcHJlbG9hZGVkIGlmIG5lZWRlZC5cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFRyYW5zbGF0ZWRBdHRyaWJ1dGVQcmVsb2Fkcyh7cXVlcnl9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxFZmZlY3RpdmVTZWxlY3RlZEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIHRoaXMuZnJvbnRlbmRNb2RlbERlZmF1bHRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB8fCBbXSlcbiAgICAgIHx8IHRoaXMuZnJvbnRlbmRNb2RlbERlZmF1bHRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFzZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiBxdWVyeVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcbiAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCB0cmFuc2xhdGVkU2V0ID0gbmV3IFNldChyZXNvdXJjZUNsYXNzLnRyYW5zbGF0ZWRBdHRyaWJ1dGVzQ29uZmlnKCkgfHwgW10pXG4gICAgbGV0IG5lZWRzVHJhbnNsYXRpb25zID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBzZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGNvbnN0IGhvb2tOYW1lID0gYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVTZWxlY3RlZGBcbiAgICAgIGNvbnN0IGR5bmFtaWNSZXNvdXJjZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlc291cmNlKSlcblxuICAgICAgaWYgKHR5cGVvZiBkeW5hbWljUmVzb3VyY2VbaG9va05hbWVdID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZHluYW1pY1Jlc291cmNlW2hvb2tOYW1lXSh7cXVlcnl9KVxuXG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICBxdWVyeSA9IHJlc3VsdFxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRyYW5zbGF0ZWRTZXQuaGFzKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICAgIG5lZWRzVHJhbnNsYXRpb25zID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChuZWVkc1RyYW5zbGF0aW9ucykge1xuICAgICAgcXVlcnkgPSBxdWVyeS5wcmVsb2FkKHt0cmFuc2xhdGlvbnM6IHt9fSlcbiAgICB9XG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHNvcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gU29ydCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTb3J0fSBhcmdzLnNvcnQgLSBTb3J0IGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsU29ydCh7cXVlcnksIHNvcnR9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgcGF0aDogc29ydC5wYXRoXG4gICAgfSlcbiAgICBjb25zdCB0cmFuc2xhdGVkQXR0cmlidXRlc01hcCA9IHRhcmdldE1vZGVsQ2xhc3MuZ2V0VHJhbnNsYXRpb25zTWFwKClcbiAgICBjb25zdCB0cmFuc2xhdGVkQXR0cmlidXRlTmFtZXMgPSBPYmplY3Qua2V5cyh0cmFuc2xhdGVkQXR0cmlidXRlc01hcClcbiAgICBjb25zdCBpc1RyYW5zbGF0ZWRTb3J0QXR0cmlidXRlID0gdHJhbnNsYXRlZEF0dHJpYnV0ZU5hbWVzLmluY2x1ZGVzKHNvcnQuY29sdW1uKVxuXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMucmVzb2x2ZUZyb250ZW5kTW9kZWxRdWVyeWFibGVDb2x1bW5OYW1lKHtcbiAgICAgIGF0dHJpYnV0ZU5hbWU6IHNvcnQuY29sdW1uLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwic29ydFwiXG4gICAgfSlcbiAgICBjb25zdCBkaXJlY3Rpb24gPSBzb3J0LmRpcmVjdGlvbi50b1VwcGVyQ2FzZSgpXG5cbiAgICBpZiAoaXNUcmFuc2xhdGVkU29ydEF0dHJpYnV0ZSkge1xuICAgICAgY29uc3QgdHJhbnNsYXRpb25Nb2RlbENsYXNzID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbkNsYXNzKClcbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCA9IHRyYW5zbGF0aW9uTW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQ29sdW1uTmFtZSA9IHRyYW5zbGF0aW9uQXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcFtzb3J0LmNvbHVtbl1cbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uUGF0aCA9IHNvcnQucGF0aC5jb25jYXQoW1wiY3VycmVudFRyYW5zbGF0aW9uXCJdKVxuXG4gICAgICBpZiAoIXRyYW5zbGF0aW9uQ29sdW1uTmFtZSkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biB0cmFuc2xhdGVkIHNvcnQgY29sdW1uIFwiJHtzb3J0LmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsU29ydEpvaW5QYXRoKHtwYXRoOiB0cmFuc2xhdGlvblBhdGgsIHF1ZXJ5fSlcblxuICAgICAgY29uc3QgdHJhbnNsYXRpb25UYWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi50cmFuc2xhdGlvblBhdGgpXG4gICAgICBjb25zdCB0cmFuc2xhdGlvbkNvbHVtblNxbCA9IGAke3F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHRyYW5zbGF0aW9uVGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbih0cmFuc2xhdGlvbkNvbHVtbk5hbWUpfWBcblxuICAgICAgcXVlcnkub3JkZXIoYCR7dHJhbnNsYXRpb25Db2x1bW5TcWx9ICR7ZGlyZWN0aW9ufWApXG5cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gc29ydCBjb2x1bW4gXCIke3NvcnQuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFNvcnRKb2luUGF0aCh7cGF0aDogc29ydC5wYXRoLCBxdWVyeX0pXG5cbiAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5zb3J0LnBhdGgpXG4gICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICBxdWVyeS5vcmRlcihgJHtjb2x1bW5TcWx9ICR7ZGlyZWN0aW9ufWApXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIHNvcnQgam9pbiBwYXRoIGhhcyBiZWVuIGpvaW5lZCBvbiBxdWVyeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBKb2luIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBqb2luIHBhdGguXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZW5zdXJlRnJvbnRlbmRNb2RlbFNvcnRKb2luUGF0aCh7cGF0aCwgcXVlcnl9KSB7XG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGgsIHF1ZXJ5fSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGEgcmVsYXRpb25zaGlwIHBhdGggaGFzIGV4YWN0bHkgb25lIFNRTCBqb2luLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW4gYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGgsIHF1ZXJ5fSkge1xuICAgIGlmIChwYXRoLmxlbmd0aCA8IDEpIHJldHVyblxuXG4gICAgY29uc3QgcXVlcnlNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KVxuICAgIGNvbnN0IGpvaW5lZFBhdGhzID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdIHx8IG5ldyBTZXQoKVxuICAgIGNvbnN0IHBhdGhLZXkgPSBwYXRoLmpvaW4oXCIuXCIpXG5cbiAgICBpZiAoam9pbmVkUGF0aHMuaGFzKHBhdGhLZXkpKSByZXR1cm5cblxuICAgIHF1ZXJ5LmpvaW5zKGJ1aWxkRnJvbnRlbmRNb2RlbEpvaW5PYmplY3RGcm9tUGF0aChwYXRoKSlcbiAgICBqb2luZWRQYXRocy5hZGQocGF0aEtleSlcbiAgICBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gPSBqb2luZWRQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0ZWQgYXR0cmlidXRlcyBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBTZWxlY3RlZCBhdHRyaWJ1dGVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBzZWxlY3QgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWxlY3QoKVxuXG4gICAgaWYgKCFzZWxlY3QpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSBzZWxlY3RbbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKV0gfHwgbnVsbFxuXG4gICAgaWYgKCFzZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsU2VsZWN0ZWRBdHRyaWJ1dGVzQWxsb3dlZCh7XG4gICAgICBhdHRyaWJ1dGVOYW1lczogc2VsZWN0ZWRBdHRyaWJ1dGVzLFxuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwic2VsZWN0XCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VsZWN0cyBleHRyYSBmb3IgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBFeHRyYSBhdHRyaWJ1dGVzIChsb2FkZWQgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHRzKSBmb3IgdGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYUZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IHNlbGVjdHNFeHRyYSA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYSgpXG5cbiAgICBpZiAoIXNlbGVjdHNFeHRyYSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGV4dHJhQXR0cmlidXRlcyA9IHNlbGVjdHNFeHRyYVttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSB8fCBudWxsXG5cbiAgICBpZiAoIWV4dHJhQXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNBbGxvd2VkKHtcbiAgICAgIGF0dHJpYnV0ZU5hbWVzOiBleHRyYUF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJzZWxlY3RzRXh0cmFcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGZpbmFsIHNldCBvZiBhdHRyaWJ1dGUgbmFtZXMgdG8gc2VyaWFsaXplIGZvciBhIG1vZGVsIGNsYXNzOlxuICAgKiBhbiBleHBsaWNpdCBuYXJyb3dpbmcgYHNlbGVjdGAgd2luczsgb3RoZXJ3aXNlLCB3aGVuIGBzZWxlY3RzRXh0cmFgIGlzIGdpdmVuLFxuICAgKiB0aGUgZGVmYXVsdCBhdHRyaWJ1dGVzIHBsdXMgdGhlIGV4dHJhczsgb3RoZXJ3aXNlIG51bGwgKGRlZmF1bHQgYmVoYXZpb3IpLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGZhbGxiYWNrQXR0cmlidXRlTmFtZXMgLSBBdHRyaWJ1dGUgbmFtZXMgdG8gdHJlYXQgYXMgdGhlIGRlZmF1bHRzIHdoZW4gdGhlIHJlc291cmNlIGRlY2xhcmVzIG5vbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IC0gRWZmZWN0aXZlIHNlbGVjdGVkIGF0dHJpYnV0ZSBuYW1lcywgb3IgbnVsbCBmb3IgZGVmYXVsdCBzZXJpYWxpemF0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEVmZmVjdGl2ZVNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcywgZmFsbGJhY2tBdHRyaWJ1dGVOYW1lcykge1xuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmIChzZWxlY3RlZEF0dHJpYnV0ZXMpIHJldHVybiBzZWxlY3RlZEF0dHJpYnV0ZXNcblxuICAgIGNvbnN0IGV4dHJhQXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdHNFeHRyYUZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmICghZXh0cmFBdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZGVmYXVsdEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxEZWZhdWx0QXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykgfHwgZmFsbGJhY2tBdHRyaWJ1dGVOYW1lc1xuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldChbLi4uZGVmYXVsdEF0dHJpYnV0ZXMsIC4uLmV4dHJhQXR0cmlidXRlc10pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZGVmYXVsdCBhdHRyaWJ1dGVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIERlZmF1bHQgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlcyBkZWNsYXJlZCBvbiB0aGUgcmVzb3VyY2UuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZT8ucmVzb3VyY2VDb25maWd1cmF0aW9uLmF0dHJpYnV0ZXNcblxuICAgIGlmICghYXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSB7XG4gICAgICByZXR1cm4gYXR0cmlidXRlc1xuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgICBjb25zdCBjb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGVudHJ5KVxuXG4gICAgICAgICAgaWYgKGNvbmZpZyAmJiBjb25maWcuc2VsZWN0ZWRCeURlZmF1bHQgPT09IGZhbHNlKSByZXR1cm4gZmFsc2VcblxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0pXG4gICAgICAgIC5tYXAoKGVudHJ5KSA9PiB0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIgPyBlbnRyeSA6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpLm5hbWUpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LmVudHJpZXMoYXR0cmlidXRlcylcbiAgICAgICAgLmZpbHRlcigoWywgY29uZmlnXSkgPT4ge1xuICAgICAgICAgIGlmICghY29uZmlnIHx8IHR5cGVvZiBjb25maWcgIT09IFwib2JqZWN0XCIpIHJldHVybiB0cnVlXG5cbiAgICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjb25maWcpLnNlbGVjdGVkQnlEZWZhdWx0ICE9PSBmYWxzZVxuICAgICAgICB9KVxuICAgICAgICAubWFwKChbbmFtZV0pID0+IG5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6ZSBmcm9udGVuZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2VyaWFsaXplZCBhdHRyaWJ1dGVzIGZpbHRlcmVkIGJ5IHNlbGVjdCBtYXAuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVGcm9udGVuZE1vZGVsQXR0cmlidXRlcyhtb2RlbCkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgY29uc3QgbW9kZWxBdHRyaWJ1dGVzID0gbW9kZWwuYXR0cmlidXRlcygpXG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsRWZmZWN0aXZlU2VsZWN0ZWRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBPYmplY3Qua2V5cyhtb2RlbEF0dHJpYnV0ZXMpKVxuICAgIGNvbnN0IGRlZmF1bHRBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgcmVzb3VyY2VJbnN0YW5jZSA9IHRoaXMuX3NlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlRm9yTW9kZWwobW9kZWwpXG5cbiAgICAvKipcbiAgICAgKiBSZXNvdXJjZSBhdHRyaWJ1dGUgbWV0aG9kIG5hbWUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFJlc291cmNlIGF0dHJpYnV0ZSBtZXRob2QgbmFtZS5cbiAgICAgKi9cbiAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZU1ldGhvZE5hbWUgPSAoYXR0cmlidXRlTmFtZSkgPT4gYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVgXG5cbiAgICAvKipcbiAgICAgKiBSZXNvdXJjZSBoYXMgYXR0cmlidXRlLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8RnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZVtcInJlc291cmNlTWV0aG9kXCJdPn0gLSBSZXNvdXJjZSBhdHRyaWJ1dGUgbWV0aG9kIGRldGFpbHMuXG4gICAgICovXG4gICAgY29uc3QgcmVzb3VyY2VBdHRyaWJ1dGVNZXRob2QgPSAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgY29uc3QgbWV0aG9kTmFtZSA9IHJlc291cmNlQXR0cmlidXRlTWV0aG9kTmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICByZXR1cm4gcmVzb3VyY2VJbnN0YW5jZT8ucmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSkgfHwgbnVsbFxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFByb3RvdHlwZSBhdHRyaWJ1dGUgbWV0aG9kLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge3ttZXRob2Q6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBvd25lck5hbWU6IHN0cmluZ30gfCB1bmRlZmluZWR9IC0gUHJvdG90eXBlIG1ldGhvZCBkZXRhaWxzIHdoZW4gcHJlc2VudC5cbiAgICAgKi9cbiAgICBjb25zdCBwcm90b3R5cGVBdHRyaWJ1dGVNZXRob2QgPSAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgbGV0IGN1cnJlbnRQcm90b3R5cGUgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YobW9kZWwpXG5cbiAgICAgIHdoaWxlIChjdXJyZW50UHJvdG90eXBlICYmIGN1cnJlbnRQcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihjdXJyZW50UHJvdG90eXBlLCBhdHRyaWJ1dGVOYW1lKT8udmFsdWVcblxuICAgICAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG1ldGhvZDogY2FuZGlkYXRlLFxuICAgICAgICAgICAgb3duZXJOYW1lOiBjdXJyZW50UHJvdG90eXBlLmNvbnN0cnVjdG9yPy5uYW1lXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY3VycmVudFByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50UHJvdG90eXBlKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFNlcmlhbGl6ZWQgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFNlcmlhbGl6ZWQgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqL1xuICAgIGNvbnN0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVWYWx1ZSA9IGFzeW5jIChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICAvLyBDaGVjayByZXNvdXJjZSBpbnN0YW5jZSBmaXJzdCAodmlydHVhbC9jb21wdXRlZCBhdHRyaWJ1dGVzIHZpYSAke25hbWV9QXR0cmlidXRlIGNvbnZlbnRpb24pXG4gICAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZSA9IHJlc291cmNlQXR0cmlidXRlTWV0aG9kKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmIChyZXNvdXJjZUF0dHJpYnV0ZSkge1xuICAgICAgICByZXR1cm4gYXdhaXQgcmVzb3VyY2VBdHRyaWJ1dGUubWV0aG9kLmNhbGwocmVzb3VyY2VBdHRyaWJ1dGUucmVzb3VyY2UsIG1vZGVsKVxuICAgICAgfVxuXG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbW9kZWwgbWV0aG9kXG4gICAgICBjb25zdCBhdHRyaWJ1dGVNZXRob2RMb29rdXAgPSBwcm90b3R5cGVBdHRyaWJ1dGVNZXRob2QoYXR0cmlidXRlTmFtZSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IGF0dHJpYnV0ZU1ldGhvZExvb2t1cD8ubWV0aG9kXG5cbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTWV0aG9kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGF0dHJpYnV0ZU1ldGhvZC5jYWxsKG1vZGVsKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbW9kZWxBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXR0cmlidXRlIGV4aXN0cy5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGF0dHJpYnV0ZSBleGlzdHMuXG4gICAgICovXG4gICAgY29uc3QgYXR0cmlidXRlRXhpc3RzID0gKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIHJldHVybiAoYXR0cmlidXRlTmFtZSBpbiBtb2RlbEF0dHJpYnV0ZXMpIHx8IChhdHRyaWJ1dGVOYW1lIGluIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAobW9kZWwpKSB8fCBCb29sZWFuKHJlc291cmNlQXR0cmlidXRlTWV0aG9kKGF0dHJpYnV0ZU5hbWUpKVxuICAgIH1cblxuICAgIGlmICghc2VsZWN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIWRlZmF1bHRBdHRyaWJ1dGVzIHx8IGRlZmF1bHRBdHRyaWJ1dGVzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgcmV0dXJuIG1vZGVsQXR0cmlidXRlc1xuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIFNlcmlhbGl6ZWQgYXR0cmlidXRlcy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBzZXJpYWxpemVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBkZWZhdWx0QXR0cmlidXRlcykge1xuICAgICAgICBpZiAoIWF0dHJpYnV0ZUV4aXN0cyhhdHRyaWJ1dGVOYW1lKSkgY29udGludWVcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCBzZXJpYWxpemVkQXR0cmlidXRlVmFsdWUoYXR0cmlidXRlTmFtZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2VyaWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgaWYgKCFhdHRyaWJ1dGVFeGlzdHMoYXR0cmlidXRlTmFtZSkpIGNvbnRpbnVlXG4gICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBzZXJpYWxpemVkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHJlcXVlc3Qtc2NvcGVkIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UgY2FjaGUuXG4gICAqIEByZXR1cm5zIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxib29sZWFuLCBpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD4+fSAtIENhY2hlLlxuICAgKi9cbiAgX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzKSB7XG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzID0gbmV3IE1hcCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb29rcyB1cCBhIGNhY2hlZCBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNSZWxhdGVkIC0gV2hldGhlciB0aGUgcmVzb3VyY2UgaXMgZm9yIGEgcmVsYXRlZCAobm9uLXJvb3QpIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ2FjaGVkIHJlc291cmNlIG9yIHVuZGVmaW5lZC5cbiAgICovXG4gIF9jYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBpc1JlbGF0ZWQpIHtcbiAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc01hcCgpLmdldChtb2RlbENsYXNzKT8uZ2V0KGlzUmVsYXRlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZXMgYSBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlIGluIHRoZSByZXF1ZXN0LXNjb3BlZCBjYWNoZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGlzUmVsYXRlZCAtIFdoZXRoZXIgdGhlIHJlc291cmNlIGlzIGZvciBhIHJlbGF0ZWQgKG5vbi1yb290KSBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gcmVzb3VyY2UgLSBSZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0Q2FjaGVkU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2UobW9kZWxDbGFzcywgaXNSZWxhdGVkLCByZXNvdXJjZSkge1xuICAgIGNvbnN0IGJ5Q2xhc3MgPSB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzTWFwKClcbiAgICBsZXQgYnlSZWxhdGVkID0gYnlDbGFzcy5nZXQobW9kZWxDbGFzcylcblxuICAgIGlmICghYnlSZWxhdGVkKSB7XG4gICAgICBieVJlbGF0ZWQgPSBuZXcgTWFwKClcbiAgICAgIGJ5Q2xhc3Muc2V0KG1vZGVsQ2xhc3MsIGJ5UmVsYXRlZClcbiAgICB9XG5cbiAgICBieVJlbGF0ZWQuc2V0KGlzUmVsYXRlZCwgcmVzb3VyY2UpXG4gIH1cblxuICAvKipcbiAgICogU2V0cyBhIHBlci1pbnN0YW5jZSBob29rIGludm9rZWQgZm9yIGV2ZXJ5IHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2VcbiAgICogcmVzb2x1dGlvbi4gVGhlIGhvb2sgaXMgc2NvcGVkIHRvIHRoaXMgY29udHJvbGxlcjsgaXQgbmV2ZXIgYWZmZWN0cyBvdGhlclxuICAgKiBjb250cm9sbGVyIGluc3RhbmNlcy4gUGFzc2luZyBgbnVsbGAgY2xlYXJzIHRoZSBob29rLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgfCBudWxsfSBob29rIC0gSG9vayBjYWxsYmFjayBvciBudWxsLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDbGVhbnVwIGZ1bmN0aW9uIHRoYXQgcmVzdG9yZXMgdGhlIHByZXZpb3VzIGhvb2suXG4gICAqL1xuICBzZXRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2soaG9vaykge1xuICAgIGNvbnN0IHByZXZpb3VzSG9vayA9IHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2tcblxuICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgPSBob29rXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayA9IHByZXZpb3VzSG9va1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UgZm9yIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdCB8IG51bGx9IC0gUmVzb3VyY2UgaW5zdGFuY2Ugb3IgbnVsbC5cbiAgICovXG4gIF9zZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUZvck1vZGVsKG1vZGVsKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBpc1JlbGF0ZWQgPSBtb2RlbENsYXNzICE9PSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgY2FjaGVkUmVzb3VyY2UgPSB0aGlzLl9jYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBpc1JlbGF0ZWQpXG5cbiAgICBpZiAoY2FjaGVkUmVzb3VyY2UpIHtcbiAgICAgIGlmICh0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rKSB7XG4gICAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sobW9kZWwsIGNhY2hlZFJlc291cmNlKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2FjaGVkUmVzb3VyY2VcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICBsZXQgcmVzb3VyY2VcblxuICAgIGlmICghaXNSZWxhdGVkKSB7XG4gICAgICByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgICB0aGlzLl9zZXRDYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBmYWxzZSwgcmVzb3VyY2UpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgICAgY29uc3QgbW9kZWxDbGFzc05hbWUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG5cbiAgICAgIHJlc291cmNlID0gbnVsbFxuXG4gICAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzV2l0aEJ1aWx0SW5zRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbENsYXNzTmFtZV1cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IHJlc291cmNlRGVmaW5pdGlvbiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKSA6IG51bGxcblxuICAgICAgICBpZiAocmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHJlc291cmNlID0gbmV3IHJlc291cmNlQ2xhc3Moe1xuICAgICAgICAgICAgYWJpbGl0eTogdGhpcy5jdXJyZW50QWJpbGl0eSgpLFxuICAgICAgICAgICAgLy8gUHJvcGFnYXRlIHRoZSBjb250cm9sbGVyIHNvIGEgcmVsYXRlZC9wcmVsb2FkZWQgbW9kZWwncyBzZXJpYWxpemF0aW9uXG4gICAgICAgICAgICAvLyByZXNvdXJjZSBjYW4gdXNlIHJlcXVlc3QgY29udGV4dCAoZS5nLiBgcmVxdWVzdEJhc2VVcmwoKWAgZm9yIHNpZ25lZFxuICAgICAgICAgICAgLy8gZG93bmxvYWQgVVJMcykuIFdpdGhvdXQgaXQsIGFueSBgPGF0dHI+QXR0cmlidXRlYCBtZXRob2QgdGhhdCByZWFjaGVzXG4gICAgICAgICAgICAvLyBmb3IgdGhlIGNvbnRyb2xsZXIgdGhyb3dzIFwicmVxdWlyZXMgYSBjb250cm9sbGVyIGluc3RhbmNlLlwiIHdoZW4gYVxuICAgICAgICAgICAgLy8gcmVsYXRpb25zaGlwIGlzIHNlcmlhbGl6ZWQgYXMgYSBwcmVsb2FkLlxuICAgICAgICAgICAgY29udHJvbGxlcjogdGhpcyxcbiAgICAgICAgICAgIGNvbnRleHQ6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0Q29udGV4dCgpIHx8IHt9LFxuICAgICAgICAgICAgbG9jYWxzOiB0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldExvY2FscygpIHx8IHt9LFxuICAgICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzc05hbWUsXG4gICAgICAgICAgICBwYXJhbXM6IHt9LFxuICAgICAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgdGhpcy5fc2V0Q2FjaGVkU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2UobW9kZWxDbGFzcywgdHJ1ZSwgcmVzb3VyY2UpXG5cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2spIHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sobW9kZWwsIHJlc291cmNlKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZmlsdGVyIHNlcmlhbGl6YWJsZSByZWxhdGVkIG1vZGVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSBhcmdzLm1vZGVscyAtIEZyb250ZW5kIG1vZGVsIHJlY29yZHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb24gLSBXaGV0aGVyIHJlbGF0aW9uIGlzIGhhcy1tYW55LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIFNlcmlhbGl6YWJsZSByZWxhdGVkIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaWx0ZXJTZXJpYWxpemFibGVSZWxhdGVkTW9kZWxzKHttb2RlbHMsIHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvbn0pIHtcbiAgICBpZiAoIXRoaXMuY3VycmVudEFiaWxpdHkoKSkgcmV0dXJuIG1vZGVsc1xuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm4gbW9kZWxzXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbHMgYnkgY2xhc3MuXG4gICAgICogQHR5cGUge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gKi9cbiAgICBjb25zdCBtb2RlbHNCeUNsYXNzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCBleGlzdGluZ01vZGVsc0ZvckNsYXNzID0gbW9kZWxzQnlDbGFzcy5nZXQocmVsYXRlZE1vZGVsQ2xhc3MpIHx8IFtdXG5cbiAgICAgIGV4aXN0aW5nTW9kZWxzRm9yQ2xhc3MucHVzaChtb2RlbClcbiAgICAgIG1vZGVsc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBleGlzdGluZ01vZGVsc0ZvckNsYXNzKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF1dGhvcml6ZWQgaWRzIGJ5IGNsYXNzLlxuICAgICAqIEB0eXBlIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIFNldDxzdHJpbmc+Pn0gKi9cbiAgICBjb25zdCBhdXRob3JpemVkSWRzQnlDbGFzcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIFByaW1hcnkga2V5cyBieSBjbGFzcy5cbiAgICAgKiBAdHlwZSB7TWFwPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb24+fSAqL1xuICAgIGNvbnN0IHByaW1hcnlLZXlzQnlDbGFzcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbcmVsYXRlZE1vZGVsQ2xhc3MsIHJlbGF0ZWRNb2RlbHNdIG9mIG1vZGVsc0J5Q2xhc3MuZW50cmllcygpKSB7XG4gICAgICBjb25zdCByZWxhdGVkUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKHJlbGF0ZWRNb2RlbENsYXNzKVxuXG4gICAgICBpZiAoIXJlbGF0ZWRSZXNvdXJjZSkge1xuICAgICAgICBhdXRob3JpemVkSWRzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIG5ldyBTZXQoKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvblxuICAgICAgICA/IHJlbGF0ZWRSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzPy5pbmRleFxuICAgICAgICA6IHJlbGF0ZWRSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzPy5maW5kXG5cbiAgICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgYXV0aG9yaXplZElkc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBuZXcgU2V0KCkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSByZWxhdGVkTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IGlkZW50aXRpZXMgPSByZWxhdGVkTW9kZWxzLm1hcCgobW9kZWwpID0+IG1vZGVsLmlkKCkpXG4gICAgICBjb25zdCBhdXRob3JpemVkSWRzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQXV0aG9yaXplZElkZW50aXR5U2V0KHtcbiAgICAgICAgaWRlbnRpdGllcyxcbiAgICAgICAgbW9kZWxDbGFzczogcmVsYXRlZE1vZGVsQ2xhc3MsXG4gICAgICAgIHByaW1hcnlLZXksXG4gICAgICAgIHF1ZXJ5OiByZWxhdGVkTW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24pXG4gICAgICB9KVxuXG4gICAgICBwcmltYXJ5S2V5c0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBwcmltYXJ5S2V5KVxuICAgICAgYXV0aG9yaXplZElkc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBhdXRob3JpemVkSWRzKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbHMuZmlsdGVyKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCBhdXRob3JpemVkSWRzID0gYXV0aG9yaXplZElkc0J5Q2xhc3MuZ2V0KHJlbGF0ZWRNb2RlbENsYXNzKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHByaW1hcnlLZXlzQnlDbGFzcy5nZXQocmVsYXRlZE1vZGVsQ2xhc3MpXG5cbiAgICAgIGlmICghYXV0aG9yaXplZElkcyB8fCAhcHJpbWFyeUtleSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiBhdXRob3JpemVkSWRzLmhhcyhtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBtb2RlbC5pZCgpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgc2VyaWFsaXphYmxlIGZyb250ZW5kIG1vZGVsLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBwcmVsb2FkZWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFdoZXRoZXIgdmFsdWUgYmVoYXZlcyBsaWtlIGEgbW9kZWwuXG4gICAqL1xuICBpc1NlcmlhbGl6YWJsZUZyb250ZW5kTW9kZWwodmFsdWUpIHtcbiAgICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXR0cmlidXRlcyA9PT0gXCJmdW5jdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IG1vZGVscyAtIE1vZGVscyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWRzLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMobW9kZWxzKSB7XG4gICAgaWYgKG1vZGVscy5sZW5ndGggPCAxKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIFByZWxvYWRlZCByZWxhdGlvbnNoaXBzIHBlciBtb2RlbC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWwgPSBBcnJheS5mcm9tKHtsZW5ndGg6IG1vZGVscy5sZW5ndGh9LCAoKSA9PiAoe30pKVxuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxhdGlvbnNoaXAgZW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2xvYWRlZE1vZGVsczogaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdLCBtb2RlbEluZGV4OiBudW1iZXIsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzID0gW11cbiAgICAvKipcbiAgICAgKiBTaW5ndWxhciByZWxhdGlvbnNoaXAgZW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2xvYWRlZE1vZGVsOiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBtb2RlbEluZGV4OiBudW1iZXIsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcyA9IFtdXG5cbiAgICBtb2RlbHMuZm9yRWFjaCgobW9kZWwsIG1vZGVsSW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBzTWFwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5fc2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VGb3JNb2RlbChtb2RlbClcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IHJlc291cmNlID8gcmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uKCkgOiBudWxsXG4gICAgICBjb25zdCBleHBvc2VkUmVsYXRpb25zaGlwcyA9IG5ldyBTZXQoXG4gICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbiAmJiBBcnJheS5pc0FycmF5KHJlc291cmNlQ29uZmlndXJhdGlvbi5yZWxhdGlvbnNoaXBzKVxuICAgICAgICAgID8gcmVzb3VyY2VDb25maWd1cmF0aW9uLnJlbGF0aW9uc2hpcHNcbiAgICAgICAgICA6IFtdXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiByZWxhdGlvbnNoaXBzTWFwKSB7XG4gICAgICAgIGlmICghZXhwb3NlZFJlbGF0aW9uc2hpcHMuaGFzKHJlbGF0aW9uc2hpcE5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICAgIGlmICghcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGxvYWRlZFJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZFJlbGF0aW9uc2hpcCkpIHtcbiAgICAgICAgICBjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcy5wdXNoKHtsb2FkZWRNb2RlbHM6IGxvYWRlZFJlbGF0aW9uc2hpcCwgbW9kZWxJbmRleCwgcmVsYXRpb25zaGlwTmFtZX0pXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLmlzU2VyaWFsaXphYmxlRnJvbnRlbmRNb2RlbChsb2FkZWRSZWxhdGlvbnNoaXApKSB7XG4gICAgICAgICAgc2luZ3VsYXJSZWxhdGlvbnNoaXBFbnRyaWVzLnB1c2goe2xvYWRlZE1vZGVsOiBsb2FkZWRSZWxhdGlvbnNoaXAsIG1vZGVsSW5kZXgsIHJlbGF0aW9uc2hpcE5hbWV9KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbbW9kZWxJbmRleF1bcmVsYXRpb25zaGlwTmFtZV0gPSBsb2FkZWRSZWxhdGlvbnNoaXAgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFJlbGF0aW9uc2hpcFxuICAgICAgfVxuICAgIH0pXG5cbiAgICBpZiAoY29sbGVjdGlvblJlbGF0aW9uc2hpcEVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYWxsQ29sbGVjdGlvbk1vZGVscyA9IGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzLmZsYXRNYXAoKGVudHJ5KSA9PiBlbnRyeS5sb2FkZWRNb2RlbHMpXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyU2VyaWFsaXphYmxlUmVsYXRlZE1vZGVscyh7XG4gICAgICAgIG1vZGVsczogYWxsQ29sbGVjdGlvbk1vZGVscyxcbiAgICAgICAgcmVsYXRpb25zaGlwSXNDb2xsZWN0aW9uOiB0cnVlXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXphYmxlQ29sbGVjdGlvbk1vZGVsc1NldCA9IG5ldyBTZXQoc2VyaWFsaXphYmxlQ29sbGVjdGlvbk1vZGVscylcblxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBFbnRyeSBvZiBjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcykge1xuICAgICAgICBjb25zdCBhbGxvd2VkTW9kZWxzID0gcmVsYXRpb25zaGlwRW50cnkubG9hZGVkTW9kZWxzLmZpbHRlcigocmVsYXRlZE1vZGVsKSA9PiBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzU2V0LmhhcyhyZWxhdGVkTW9kZWwpKVxuICAgICAgICBjb25zdCBzZXJpYWxpemVkUmVsYXRlZE1vZGVscyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMoYWxsb3dlZE1vZGVscylcblxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBzZXJpYWxpemVkUmVsYXRlZE1vZGVsc1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYWxsU2luZ3VsYXJNb2RlbHMgPSBzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMubWFwKChlbnRyeSkgPT4gZW50cnkubG9hZGVkTW9kZWwpXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVTaW5ndWxhck1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlclNlcmlhbGl6YWJsZVJlbGF0ZWRNb2RlbHMoe1xuICAgICAgICBtb2RlbHM6IGFsbFNpbmd1bGFyTW9kZWxzLFxuICAgICAgICByZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb246IGZhbHNlXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXphYmxlU2luZ3VsYXJNb2RlbHNTZXQgPSBuZXcgU2V0KHNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzKVxuXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcEVudHJ5IG9mIHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcykge1xuICAgICAgICBpZiAoIXNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzU2V0LmhhcyhyZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbCkpIHtcbiAgICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBudWxsXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IChhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxzKFtyZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbF0pKVswXVxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBzZXJpYWxpemVkTW9kZWxcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVkIG1vZGVscy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W119ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZE1vZGVscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFttb2RlbEluZGV4LCBtb2RlbF0gb2YgbW9kZWxzLmVudHJpZXMoKSkge1xuICAgICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsKVxuICAgICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFttb2RlbEluZGV4XVxuICAgICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBtb2RlbC5hc3NvY2lhdGlvbkNvdW50cygpXG4gICAgICBjb25zdCBxdWVyeURhdGFWYWx1ZXMgPSBtb2RlbC5xdWVyeURhdGFWYWx1ZXMoKVxuICAgICAgY29uc3QgY29tcHV0ZWRBYmlsaXRpZXMgPSBtb2RlbC5jb21wdXRlZEFiaWxpdGllcygpXG4gICAgICBjb25zdCBoYXNDb3VudHMgPSBPYmplY3Qua2V5cyhhc3NvY2lhdGlvbkNvdW50cykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzUXVlcnlEYXRhID0gT2JqZWN0LmtleXMocXVlcnlEYXRhVmFsdWVzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNBYmlsaXRpZXMgPSBPYmplY3Qua2V5cyhjb21wdXRlZEFiaWxpdGllcykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzUHJlbG9hZGVkID0gT2JqZWN0LmtleXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLl9zZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUZvck1vZGVsKG1vZGVsKVxuICAgICAgY29uc3QgaGFzQXR0YWNobWVudE93bmVyID0gT2JqZWN0LmtleXMocmVzb3VyY2U/LnJlc291cmNlQ29uZmlndXJhdGlvbigpLmF0dGFjaG1lbnRzIHx8IHt9KS5sZW5ndGggPiAwXG5cbiAgICAgIGlmICghaGFzUHJlbG9hZGVkICYmICFoYXNDb3VudHMgJiYgIWhhc1F1ZXJ5RGF0YSAmJiAhaGFzQWJpbGl0aWVzICYmICFoYXNBdHRhY2htZW50T3duZXIpIHtcbiAgICAgICAgc2VyaWFsaXplZE1vZGVscy5wdXNoKHNlcmlhbGl6ZWRBdHRyaWJ1dGVzKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIFNlcmlhbGl6ZWQuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3Qgc2VyaWFsaXplZCA9IHsuLi5zZXJpYWxpemVkQXR0cmlidXRlc31cblxuICAgICAgaWYgKGhhc1ByZWxvYWRlZCkgc2VyaWFsaXplZC5fX3ByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG4gICAgICBpZiAoaGFzQ291bnRzKSBzZXJpYWxpemVkLl9fYXNzb2NpYXRpb25Db3VudHMgPSBhc3NvY2lhdGlvbkNvdW50c1xuICAgICAgaWYgKGhhc1F1ZXJ5RGF0YSkgc2VyaWFsaXplZC5fX3F1ZXJ5RGF0YSA9IHF1ZXJ5RGF0YVZhbHVlc1xuICAgICAgaWYgKGhhc0FiaWxpdGllcykgc2VyaWFsaXplZC5fX2FiaWxpdGllcyA9IGNvbXB1dGVkQWJpbGl0aWVzXG4gICAgICBpZiAoaGFzQXR0YWNobWVudE93bmVyKSB7XG4gICAgICAgIGlmICghcmVzb3VyY2UpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBmb3IgYXR0YWNobWVudCBvd25lciAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbC5nZXRNb2RlbENsYXNzKClcblxuICAgICAgICBzZXJpYWxpemVkW0FUVEFDSE1FTlRfT1dORVJfS0VZXSA9IHtcbiAgICAgICAgICByZWNvcmRJZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkobW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIG1vZGVsLmlkKCkpLFxuICAgICAgICAgIHJlY29yZFR5cGU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgcmVzb3VyY2VOYW1lOiByZXNvdXJjZS5tb2RlbE5hbWUoKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHNlcmlhbGl6ZWRNb2RlbHMucHVzaChzZXJpYWxpemVkKVxuICAgIH1cblxuICAgIHJldHVybiBzZXJpYWxpemVkTW9kZWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUgZnJvbnRlbmQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBGcm9udGVuZCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2VyaWFsaXplZCBmcm9udGVuZCBtb2RlbCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplRnJvbnRlbmRNb2RlbChtb2RlbCkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbHMgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxzKFttb2RlbF0pXG5cbiAgICByZXR1cm4gc2VyaWFsaXplZE1vZGVsc1swXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVuZGVyIGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXJyb3JNZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlcnJvciBoYXMgYmVlbiByZW5kZXJlZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxSZW5kZXJFcnJvcihlcnJvck1lc3NhZ2UpIHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBmYWlsZWQ6ICR7ZXJyb3JNZXNzYWdlfWApXG5cbiAgICBjb25zdCByZW5kZXJFcnJvciA9IC8qKiBAdHlwZSB7KChlcnJvck1lc3NhZ2U6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPikgfCB1bmRlZmluZWR9ICovIChcbiAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKS5yZW5kZXJFcnJvclxuICAgIClcblxuICAgIGlmICh0eXBlb2YgcmVuZGVyRXJyb3IgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgcmVuZGVyRXJyb3IuY2FsbCh0aGlzLCBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGVycm9yIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBlcnJvck1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gU3RydWN0dXJlZCBlcnJvciBmaWVsZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gW29wdGlvbnMuZGV0YWlsc10gLSBDbGllbnQtc2FmZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge1wiYXBwbGljYXRpb25fZXJyb3JcIiB8IFwiYXV0aG9yaXphdGlvbl9lcnJvclwiIHwgXCJpbnRlcm5hbF9lcnJvclwiIHwgXCJyZWNvcmRfbm90X2ZvdW5kXCIgfCBcInZhbGlkYXRpb25fZXJyb3JcIn0gW29wdGlvbnMuZXJyb3JUeXBlXSAtIFN0YWJsZSBjbGllbnQtZmFjaW5nIGVycm9yIGNhdGVnb3J5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEVycm9yIHBheWxvYWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGVycm9yTWVzc2FnZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLihvcHRpb25zLmRldGFpbHMgPyB7ZGV0YWlsczogb3B0aW9ucy5kZXRhaWxzfSA6IHt9KSxcbiAgICAgIGVycm9yTWVzc2FnZSxcbiAgICAgIC4uLihvcHRpb25zLmVycm9yVHlwZSA/IHtlcnJvclR5cGU6IG9wdGlvbnMuZXJyb3JUeXBlfSA6IHt9KSxcbiAgICAgIHN0YXR1czogXCJlcnJvclwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY2xpZW50IHNhZmUgZXJyb3IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGllbnQtc2FmZSBlcnJvciBwYXlsb2FkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvclBheWxvYWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgZnJvbnRlbmQtbW9kZWwgZW5kcG9pbnQgZXJyb3IgY29udGV4dCBmb3IgbG9nZ2luZyBhbmQgY2xpZW50IHBheWxvYWQgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVycm9yIGNvbnRleHQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gRW5kcG9pbnQvYWN0aW9uIGxhYmVsLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCIgfCBcImN1c3RvbS1jb21tYW5kXCJ9IFthcmdzLmNvbW1hbmRUeXBlXSAtIEZyb250ZW5kLW1vZGVsIGNvbW1hbmQgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFthcmdzLm1vZGVsXSAtIFJlcXVlc3QgbW9kZWwgbmFtZSB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFthcmdzLnJlcXVlc3RJZF0gLSBCYXRjaCByZXF1ZXN0IGlkIHdoZW4gYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0fSBGcm9udGVuZC1tb2RlbCBlbmRwb2ludCBlcnJvciBjb250ZXh0LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHthY3Rpb24sIGNvbW1hbmRUeXBlLCBlcnJvciwgbW9kZWwsIHJlcXVlc3RJZH0pIHtcbiAgICBsZXQgcmVzb2x2ZWRNb2RlbCA9IG1vZGVsXG4gICAgY29uc3QgZXhwZWN0ZWRFcnJvciA9IGZyb250ZW5kTW9kZWxFeHBlY3RlZEVycm9yKGVycm9yKVxuXG4gICAgaWYgKCFyZXNvbHZlZE1vZGVsKSB7XG4gICAgICBjb25zdCBjYWNoZWRQYXJhbXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgfHwgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc1xuICAgICAgY29uc3QgcGFyYW1zTW9kZWwgPSBjYWNoZWRQYXJhbXMgPyBjYWNoZWRQYXJhbXMubW9kZWwgOiB1bmRlZmluZWRcbiAgICAgIHJlc29sdmVkTW9kZWwgPSB0eXBlb2YgcGFyYW1zTW9kZWwgPT09IFwic3RyaW5nXCIgJiYgcGFyYW1zTW9kZWwubGVuZ3RoID4gMCA/IHBhcmFtc01vZGVsIDogdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgY29udHJvbGxlcjogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgLi4uKGV4cGVjdGVkRXJyb3IgPyB7fSA6IHtjb3JyZWxhdGlvbklkOiByYW5kb21VVUlEKCl9KSxcbiAgICAgIGV4cGVjdGVkRXJyb3IsXG4gICAgICBmcm9udGVuZE1vZGVsRW5kcG9pbnQ6IHRydWUsXG4gICAgICBtb2RlbDogcmVzb2x2ZWRNb2RlbCxcbiAgICAgIHJlcXVlc3RJZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsaWVudCBlcnJvciBwYXlsb2FkIGZvciBlcnJvci5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQgfCB1bmRlZmluZWR9IFtlbmRwb2ludEVycm9yQ29udGV4dF0gLSBGcm9udGVuZC1tb2RlbCBlbmRwb2ludCBlcnJvciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkPn0gLSBDbGllbnQgcGF5bG9hZCBmb3IgdGhlIGN1cnJlbnQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVuZHBvaW50RXJyb3JDb250ZXh0KSB7XG4gICAgY29uc3QgdmVsb2Npb3VzTWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsVmVsb2Npb3VzTWV0YWRhdGFGb3JFcnJvcihlcnJvcilcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9ICovXG4gICAgY29uc3Qgc2FmZUVycm9yUGF5bG9hZCA9IHt9XG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICAgIGlmIChlcnJvci5lcnJvclR5cGUpIHNhZmVFcnJvclBheWxvYWQuZXJyb3JUeXBlID0gZXJyb3IuZXJyb3JUeXBlXG4gICAgICBpZiAoZXJyb3IuZGV0YWlscykgc2FmZUVycm9yUGF5bG9hZC5kZXRhaWxzID0gZXJyb3IuZGV0YWlsc1xuICAgIH0gZWxzZSBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZWNvcmROb3RGb3VuZEVycm9yKSB7XG4gICAgICBzYWZlRXJyb3JQYXlsb2FkLmVycm9yVHlwZSA9IFwicmVjb3JkX25vdF9mb3VuZFwiXG4gICAgfSBlbHNlIGlmICh2ZWxvY2lvdXNNZXRhZGF0YSkge1xuICAgICAgaWYgKHR5cGVvZiB2ZWxvY2lvdXNNZXRhZGF0YS5lcnJvclR5cGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgc2FmZUVycm9yUGF5bG9hZC5lcnJvclR5cGUgPSB2ZWxvY2lvdXNNZXRhZGF0YS5lcnJvclR5cGVcbiAgICAgIH1cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KHZlbG9jaW91c01ldGFkYXRhLmRldGFpbHMpKSB7XG4gICAgICAgIHNhZmVFcnJvclBheWxvYWQuZGV0YWlscyA9IHZlbG9jaW91c01ldGFkYXRhLmRldGFpbHNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgdmFsaWRhdGlvbkVycm9yc1BheWxvYWQgPSB7fVxuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JzID0gZXJyb3IuZ2V0VmFsaWRhdGlvbkVycm9ycygpXG4gICAgICBjb25zdCBtb2RlbCA9IGVycm9yLmdldE1vZGVsKClcbiAgICAgIC8qKlxuICAgICAgICogU3RydWN0dXJlZCBlcnJvcnMuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3R5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBmdWxsTWVzc2FnZTogc3RyaW5nfVtdPn0gKi9cbiAgICAgIGNvbnN0IHN0cnVjdHVyZWRFcnJvcnMgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdmFsaWRhdGlvbkVycm9ycykge1xuICAgICAgICBzdHJ1Y3R1cmVkRXJyb3JzW2F0dHJpYnV0ZU5hbWVdID0gdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXS5tYXAoZXJyID0+ICh7XG4gICAgICAgICAgdHlwZTogZXJyLnR5cGUsXG4gICAgICAgICAgbWVzc2FnZTogZXJyLm1lc3NhZ2UsXG4gICAgICAgICAgZnVsbE1lc3NhZ2U6IGAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5odW1hbkF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSl9ICR7ZXJyLm1lc3NhZ2V9YFxuICAgICAgICB9KSlcbiAgICAgIH1cblxuICAgICAgdmFsaWRhdGlvbkVycm9yc1BheWxvYWQgPSB7XG4gICAgICAgIGVycm9yVHlwZTogXCJ2YWxpZGF0aW9uX2Vycm9yXCIsXG4gICAgICAgIHZhbGlkYXRpb25FcnJvcnM6IHN0cnVjdHVyZWRFcnJvcnNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXBvcnRlclBheWxvYWQgPSBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5jbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcih7XG4gICAgICBjb250ZXh0OiBlbmRwb2ludEVycm9yQ29udGV4dCB8fCB7Y29udHJvbGxlcjogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3IsXG4gICAgICByZXF1ZXN0OiB0aGlzLmdldFJlcXVlc3QoKVxuICAgIH0pXG5cbiAgICBpZiAoIXRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkpIHtcbiAgICAgIGRlbGV0ZSByZXBvcnRlclBheWxvYWQuZGVidWdCYWNrdHJhY2VcbiAgICAgIGRlbGV0ZSByZXBvcnRlclBheWxvYWQuZGVidWdFcnJvckNsYXNzXG4gICAgICBkZWxldGUgcmVwb3J0ZXJQYXlsb2FkLmRlYnVnRXJyb3JNZXNzYWdlXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnJlcG9ydGVyUGF5bG9hZCxcbiAgICAgIC4uLnRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChmcm9udGVuZE1vZGVsQ2xpZW50TWVzc2FnZUZvckVycm9yKFxuICAgICAgICBlcnJvcixcbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKVxuICAgICAgKSksXG4gICAgICAuLi5mcm9udGVuZE1vZGVsRGVidWdQYXlsb2FkRm9yRXJyb3Ioe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZXJyb3JcbiAgICAgIH0pLFxuICAgICAgLi4uKHZlbG9jaW91c01ldGFkYXRhID8ge3ZlbG9jaW91czogdmVsb2Npb3VzTWV0YWRhdGF9IDoge30pLFxuICAgICAgLi4uc2FmZUVycm9yUGF5bG9hZCxcbiAgICAgIC4uLnZhbGlkYXRpb25FcnJvcnNQYXlsb2FkLFxuICAgICAgLi4uKCFlbmRwb2ludEVycm9yQ29udGV4dD8uZXhwZWN0ZWRFcnJvciAmJiBlbmRwb2ludEVycm9yQ29udGV4dD8uY29ycmVsYXRpb25JZFxuICAgICAgICA/IHtjb3JyZWxhdGlvbklkOiBlbmRwb2ludEVycm9yQ29udGV4dC5jb3JyZWxhdGlvbklkLCBlcnJvclR5cGU6IFwiaW50ZXJuYWxfZXJyb3JcIn1cbiAgICAgICAgOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBsb2cgZW5kcG9pbnQgZXJyb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRXJyb3IgbG9nIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0fSBhcmdzLmVycm9yQ29udGV4dCAtIFNoYXJlZCBjbGllbnQvbG9nZ2luZyBlcnJvciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsb2dnaW5nLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KSB7XG4gICAgLy8gRXhwZWN0ZWQgdXNlci1mbG93IGVycm9ycyBhcmUgc3VyZmFjZWQgdG8gY2xpZW50cyBieVxuICAgIC8vIGZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvciwgYnV0IHNraXBwZWQgaGVyZSBzbyBtb25pdG9yaW5nXG4gICAgLy8gc3RheXMgZm9jdXNlZCBvbiByZWFsIGJhY2tlbmQgZmFpbHVyZXMuXG4gICAgaWYgKGVycm9yQ29udGV4dC5leHBlY3RlZEVycm9yKSByZXR1cm5cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHJlZGFjdG9yID0gY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcmVkYWN0ZWRFcnJvciA9IHJlZGFjdG9yLnJlZGFjdEVycm9yKG5vcm1hbGl6ZWRFcnJvciwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIGNvbnN0IHJlZGFjdGVkQ29udGV4dCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0fSAqLyAocmVkYWN0b3IucmVkYWN0U3RydWN0dXJlZChlcnJvckNvbnRleHQsIHNlbnNpdGl2ZVZhbHVlcykpXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGcm9udGVuZCBtb2RlbCBlbmRwb2ludCByZXF1ZXN0IGZhaWxlZFwiLCB7XG4gICAgICBhY3Rpb246IHJlZGFjdGVkQ29udGV4dC5hY3Rpb24sXG4gICAgICBjb21tYW5kVHlwZTogcmVkYWN0ZWRDb250ZXh0LmNvbW1hbmRUeXBlLFxuICAgICAgY29ycmVsYXRpb25JZDogcmVkYWN0ZWRDb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICBlcnJvckJhY2t0cmFjZTogcmVkYWN0ZWRFcnJvci5zdGFjayxcbiAgICAgIGVycm9yQ2xhc3M6IHJlZGFjdGVkRXJyb3IubmFtZSxcbiAgICAgIGVycm9yTWVzc2FnZTogcmVkYWN0ZWRFcnJvci5tZXNzYWdlLFxuICAgICAgbW9kZWw6IHJlZGFjdGVkQ29udGV4dC5tb2RlbCxcbiAgICAgIHJlcXVlc3RJZDogcmVkYWN0ZWRDb250ZXh0LnJlcXVlc3RJZFxuICAgIH1dKVxuXG4gICAgLy8gU3VyZmFjZSBnZW51aW5lbHkgdW5leHBlY3RlZCBiYWNrZW5kIGZhaWx1cmVzIG9uIHRoZSBmcmFtZXdvcmstZXJyb3JcbiAgICAvLyBjaGFubmVsIHNvIHByb2Nlc3MtbGV2ZWwgYnVnIHJlcG9ydGVycyBjYXB0dXJlIHRoZW0sIGluc3RlYWQgb2YgdGhlXG4gICAgLy8gY29udHJvbGxlciBzaWxlbnRseSBzd2FsbG93aW5nIHRoZW0gYmVoaW5kIHRoZSBnZW5lcmljIFwiUmVxdWVzdFxuICAgIC8vIGZhaWxlZC5cIiBjbGllbnQgbWVzc2FnZS5cbiAgICBjb25zdCBlcnJvclBheWxvYWQgPSB7XG4gICAgICBjb3JyZWxhdGlvbklkOiByZWRhY3RlZENvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGNvbnRleHQ6IHJlZGFjdGVkQ29udGV4dCxcbiAgICAgIGVycm9yOiByZWRhY3RlZEVycm9yLFxuICAgICAgcmVxdWVzdDogdGhpcy5nZXRSZXF1ZXN0KCksXG4gICAgICByZXF1ZXN0RGV0YWlsczogcmVxdWVzdERldGFpbHModGhpcy5nZXRSZXF1ZXN0KCksIHtyZWRhY3Rvciwgc2Vuc2l0aXZlVmFsdWVzfSlcbiAgICB9XG5cbiAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImFsbC1lcnJvclwiLCB7Li4uZXJyb3JQYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVuZGVyIGNvbW1hbmQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXNwb25zZSBoYXMgYmVlbiByZW5kZXJlZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoYWN0aW9uKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbW1hbmRQYXlsb2FkKGFjdGlvbilcbiAgICAgIGlmICghcmVzcG9uc2VQYXlsb2FkKSByZXR1cm5cblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXNwb25zZVBheWxvYWQsIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSB0aGlzLmZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCh7YWN0aW9uLCBjb21tYW5kVHlwZTogYWN0aW9uLCBlcnJvcn0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZChhY3Rpb24pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgIGlmICghKGF3YWl0IHRoaXMucnVuRnJvbnRlbmRNb2RlbEJlZm9yZUFjdGlvbihhY3Rpb24pKSkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJpbmRleFwiKSB7XG4gICAgICBpZiAodGhpcy5mcm9udGVuZE1vZGVsQ291bnRSZXF1ZXN0ZWQoKSkge1xuICAgICAgICBpZiAoIShhd2FpdCByZXNvdXJjZS5zdXBwb3J0c0NvdW50KFwiaW5kZXhcIikpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY291bnQgaXMgbm90IHN1cHBvcnRlZCB3aGVuIHJlc291cmNlIHJlY29yZHMgYXJlIGN1c3RvbWl6ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY291bnQ6IGF3YWl0IHJlc291cmNlLmNvdW50KCksXG4gICAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBsdWNrID0gdGhpcy5mcm9udGVuZE1vZGVsUGx1Y2soKVxuXG4gICAgICBpZiAocGx1Y2subGVuZ3RoID4gMCkge1xuICAgICAgICBpZiAoIShhd2FpdCByZXNvdXJjZS5zdXBwb3J0c1BsdWNrKFwiaW5kZXhcIikpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicGx1Y2sgaXMgbm90IHN1cHBvcnRlZCB3aGVuIHJlc291cmNlIHJlY29yZHMgYXJlIGN1c3RvbWl6ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHZhbHVlcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFBsdWNrVmFsdWVzKHtcbiAgICAgICAgICBwbHVjayxcbiAgICAgICAgICBxdWVyeTogcmVzb3VyY2UuaW5kZXhRdWVyeSgpXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiLFxuICAgICAgICAgIHZhbHVlc1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlY29yZHMoKVxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhtb2RlbHMpXG4gICAgICBjb25zdCBzZXJpYWxpemVkTW9kZWxzID0gYXdhaXQgUHJvbWlzZS5hbGwobW9kZWxzLm1hcChhc3luYyAobW9kZWwpID0+IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZShtb2RlbCwgXCJpbmRleFwiKSkpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIG1vZGVsczogc2VyaWFsaXplZE1vZGVscyxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgbGV0IGlkID0gcGFyYW1zLmlkXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImNyZWF0ZVwiKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgbXV0YXRpb25BdHRyaWJ1dGVzID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKG11dGF0aW9uQXR0cmlidXRlcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDcmVhdGVSZWNvcmQoXG4gICAgICAgIG11dGF0aW9uQXR0cmlidXRlcy5hdHRyaWJ1dGVzLFxuICAgICAgICBtdXRhdGlvbkF0dHJpYnV0ZXMubmVzdGVkQXR0cmlidXRlcyxcbiAgICAgICAgbXV0YXRpb25BdHRyaWJ1dGVzLmF0dGFjaG1lbnRzXG4gICAgICApXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZShtb2RlbCwgXCJjcmVhdGVcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgJiYgKCh0eXBlb2YgaWQgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSB8fCBgJHtpZH1gLmxlbmd0aCA8IDEpKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgbW9kZWwgaWQuXCIsIHtlcnJvclR5cGU6IFwidmFsaWRhdGlvbl9lcnJvclwifSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgJiYgdHlwZW9mIGlkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlkID0gbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXkocHJpbWFyeUtleSwgaWQpXG4gICAgICB9XG5cbiAgICAgIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgVHlwZUVycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChlcnJvci5tZXNzYWdlLCB7ZXJyb3JUeXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJhdHRhY2hcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudE5hbWUgPSBwYXJhbXMuYXR0YWNobWVudE5hbWVcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRJbnB1dCA9IHBhcmFtcy5hdHRhY2htZW50XG5cbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudE5hbWUgIT09IFwic3RyaW5nXCIgfHwgYXR0YWNobWVudE5hbWUubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgYXR0YWNobWVudE5hbWUuXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudElucHV0ID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCBhdHRhY2htZW50IGlucHV0LlwiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJhdHRhY2hcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLmF0dGFjaChhdHRhY2htZW50SW5wdXQpXG4gICAgICBjb25zdCBzZXJpYWxpemVkTW9kZWwgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG5cbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2VzcyhzZXJpYWxpemVkTW9kZWwpXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkb3dubG9hZFwiKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGFyYW1zID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKVxuICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50UGFyYW1zID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGF0dGFjaG1lbnRQYXJhbXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImRvd25sb2FkXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkb3dubG9hZGVkQXR0YWNobWVudCA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkuZG93bmxvYWQoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50SWQpXG5cbiAgICAgIGlmICghZG93bmxvYWRlZEF0dGFjaG1lbnQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkF0dGFjaG1lbnQgbm90IGZvdW5kLlwiLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGF0dGFjaG1lbnQ6IHtcbiAgICAgICAgICBieXRlU2l6ZTogZG93bmxvYWRlZEF0dGFjaG1lbnQuYnl0ZVNpemUoKSxcbiAgICAgICAgICBjb250ZW50QmFzZTY0OiBkb3dubG9hZGVkQXR0YWNobWVudC5jb250ZW50KCkudG9TdHJpbmcoXCJiYXNlNjRcIiksXG4gICAgICAgICAgY29udGVudFR5cGU6IGRvd25sb2FkZWRBdHRhY2htZW50LmNvbnRlbnRUeXBlKCksXG4gICAgICAgICAgZmlsZW5hbWU6IGRvd25sb2FkZWRBdHRhY2htZW50LmZpbGVuYW1lKCksXG4gICAgICAgICAgaWQ6IGRvd25sb2FkZWRBdHRhY2htZW50LmlkKCksXG4gICAgICAgICAgdXJsOiBkb3dubG9hZGVkQXR0YWNobWVudC51cmwoKVxuICAgICAgICB9LFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cmxcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBhcmFtcyA9IGZyb250ZW5kTW9kZWxBdHRhY2htZW50UGFyYW1zKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudFBhcmFtcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChhdHRhY2htZW50UGFyYW1zKVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJ1cmxcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVybCA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkudXJsKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudElkKVxuXG4gICAgICBpZiAoIXVybCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQXR0YWNobWVudCBVUkwgbm90IGF2YWlsYWJsZS5cIilcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgdXJsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJhdHRhY2htZW50TGlzdFwiKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGFyYW1zID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKVxuICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50UGFyYW1zID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGF0dGFjaG1lbnRQYXJhbXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImF0dGFjaG1lbnRMaXN0XCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkubGlzdE1ldGFkYXRhKClcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYXR0YWNobWVudHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWN0aW9uID09PSBcImZpbmRcIikge1xuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwiZmluZFwiLCBpZClcblxuICAgICAgaWYgKCFtb2RlbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGAke21vZGVsQ2xhc3MubmFtZX0gbm90IGZvdW5kLmAsIHtlcnJvclR5cGU6IFwicmVjb3JkX25vdF9mb3VuZFwifSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhbbW9kZWxdKVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKG1vZGVsLCBcImZpbmRcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgbXV0YXRpb25BdHRyaWJ1dGVzID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKG11dGF0aW9uQXR0cmlidXRlcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwidXBkYXRlXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCB1cGRhdGVkTW9kZWwgPSBhd2FpdCByZXNvdXJjZS51cGRhdGUobW9kZWwsIG11dGF0aW9uQXR0cmlidXRlcy5hdHRyaWJ1dGVzLCB7XG4gICAgICAgIGF0dGFjaG1lbnRzOiBtdXRhdGlvbkF0dHJpYnV0ZXMuYXR0YWNobWVudHMsXG4gICAgICAgIGNvbnRyb2xsZXI6IHRoaXMsXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IG11dGF0aW9uQXR0cmlidXRlcy5uZXN0ZWRBdHRyaWJ1dGVzXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKHVwZGF0ZWRNb2RlbCwgXCJ1cGRhdGVcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJkZXN0cm95XCIsIGlkKVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgfVxuXG4gICAgYXdhaXQgcmVzb3VyY2UuZGVzdHJveShtb2RlbClcblxuICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgYm9vdHN0cmFwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIGJvb3RzdHJhcCByZXNwb25zZSB3aXRoIG1hbmlmZXN0IGFuZCBzaWduZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY0Jvb3RzdHJhcCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBzeW5jTWFuaWZlc3QgPSBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50ID0gYXdhaXQgY3JlYXRlT2ZmbGluZUdyYW50RnJvbUJvb3RzdHJhcCh7XG4gICAgICBkZXZpY2VJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBEZXZpY2VJZChwYXJhbXMpLFxuICAgICAgZ3JhbnRJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBHcmFudElkKHBhcmFtcyksXG4gICAgICBncmFudFR0bE1zOiBjb25maWd1cmF0aW9uLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50VHRsTXMsXG4gICAgICBub3c6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwTm93KHBhcmFtcyksXG4gICAgICByZXNvdXJjZXM6IHN5bmNNYW5pZmVzdCxcbiAgICAgIHNjb3BlczogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBTY29wZXMocGFyYW1zKSxcbiAgICAgIHNpZ25pbmdLZXk6IGNvbmZpZ3VyYXRpb24uY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoKSxcbiAgICAgIHVzZXJJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBVc2VySWQoKVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIG9mZmxpbmVHcmFudCxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgc3luY01hbmlmZXN0XG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZGV2aWNlIGlkIGZvciBzeW5jIGJvb3RzdHJhcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXZpY2UgaWQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBEZXZpY2VJZChwYXJhbXMpIHtcbiAgICBpZiAodHlwZW9mIHBhcmFtcy5kZXZpY2VJZCA9PT0gXCJzdHJpbmdcIiAmJiBwYXJhbXMuZGV2aWNlSWQubGVuZ3RoID4gMCkgcmV0dXJuIHBhcmFtcy5kZXZpY2VJZFxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBib290c3RyYXAgZGV2aWNlSWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBncmFudCBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlIHwgdW5kZWZpbmVkPn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGV0ZXJtaW5pc3RpYyBncmFudCBpZCBmb3IgdGVzdHMsIGdlbmVyYXRlZCBpZCBvdGhlcndpc2UuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBHcmFudElkKHBhcmFtcykge1xuICAgIGlmICh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiAmJiB0eXBlb2YgcGFyYW1zLmdyYW50SWQgPT09IFwic3RyaW5nXCIpIHJldHVybiBwYXJhbXMuZ3JhbnRJZFxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGJvb3RzdHJhcCBpc3N1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBJc3N1ZSB0aW1lLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwTm93KHBhcmFtcykge1xuICAgIGlmICh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiAmJiB0eXBlb2YgcGFyYW1zLm5vdyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIG5ldyBEYXRlKHBhcmFtcy5ub3cpXG5cbiAgICByZXR1cm4gbmV3IERhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgYm9vdHN0cmFwIHNjb3Blcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gR3JhbnQgc2NvcGVzLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwU2NvcGVzKHBhcmFtcykge1xuICAgIGNvbnN0IHNjb3BlcyA9IHBhcmFtcy5zY29wZXNcblxuICAgIGlmIChzY29wZXMgJiYgdHlwZW9mIHNjb3BlcyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShzY29wZXMpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoc2NvcGVzKVxuICAgIH1cblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGN1cnJlbnQgdXNlciBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVXNlciBpZC5cbiAgICovXG4gIGZyb250ZW5kU3luY0Jvb3RzdHJhcFVzZXJJZCgpIHtcbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG4gICAgY29uc3QgY3VycmVudFVzZXIgPSBhYmlsaXR5Py5jdXJyZW50VXNlcigpXG5cbiAgICBpZiAodHlwZW9mIGN1cnJlbnRVc2VyID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBjdXJyZW50VXNlciA9PT0gXCJudW1iZXJcIikgcmV0dXJuIFN0cmluZyhjdXJyZW50VXNlcilcbiAgICBpZiAoY3VycmVudFVzZXIgJiYgdHlwZW9mIGN1cnJlbnRVc2VyID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjb25zdCB1c2VyUmVjb3JkID0gLyoqIEB0eXBlIHt7aWQ/OiBzdHJpbmcgfCBudW1iZXIgfCAoKCkgPT4gc3RyaW5nIHwgbnVtYmVyKX19ICovIChjdXJyZW50VXNlcilcbiAgICAgIGNvbnN0IGlkVmFsdWUgPSB0eXBlb2YgdXNlclJlY29yZC5pZCA9PT0gXCJmdW5jdGlvblwiID8gdXNlclJlY29yZC5pZCgpIDogdXNlclJlY29yZC5pZFxuXG4gICAgICBpZiAodHlwZW9mIGlkVmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGlkVmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiBTdHJpbmcoaWRWYWx1ZSlcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGJvb3RzdHJhcCBjdXJyZW50IHVzZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgcmVwbGF5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIHJlcGxheSByZXNwb25zZSB3aXRoIHBlci1tdXRhdGlvbiByZXN1bHRzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5KCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3Qgc2lnbmVkTXV0YXRpb25zID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlTaWduZWRNdXRhdGlvbnMocGFyYW1zKVxuICAgIGNvbnN0IHJlc3VsdHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzaWduZWRNdXRhdGlvbiBvZiBzaWduZWRNdXRhdGlvbnMpIHtcbiAgICAgIGxldCBpZGVtcG90ZW5jeUtleSA9IG51bGxcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXkgPSBtdXRhdGlvbklkZW1wb3RlbmN5S2V5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbikpXG4gICAgICAgIGNvbnN0IHtyZXNwb25zZSwgc2VydmVyQ2hhbmdlRmVlZEVycm9yLCBzZXJ2ZXJDaGFuZ2VGZWVkU3RhdHVzLCBzZXJ2ZXJTZXF1ZW5jZX0gPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9uKHNpZ25lZE11dGF0aW9uKVxuXG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgc2VydmVyQ2hhbmdlRmVlZEVycm9yLFxuICAgICAgICAgIHNlcnZlckNoYW5nZUZlZWRTdGF0dXMsXG4gICAgICAgICAgc2VydmVyU2VxdWVuY2UsXG4gICAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICAgIGFjdGlvbjogXCJmcm9udGVuZFN5bmNSZXBsYXlcIixcbiAgICAgICAgICBjb21tYW5kVHlwZTogc2lnbmVkTXV0YXRpb24gJiYgdHlwZW9mIHNpZ25lZE11dGF0aW9uID09PSBcIm9iamVjdFwiICYmIFwibXV0YXRpb25cIiBpbiBzaWduZWRNdXRhdGlvblxuICAgICAgICAgICAgPyAvKiogQHR5cGUge3ttdXRhdGlvbj86IHtvcGVyYXRpb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19fSAqLyAoc2lnbmVkTXV0YXRpb24pLm11dGF0aW9uPy5vcGVyYXRpb25cbiAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIG1vZGVsOiBzaWduZWRNdXRhdGlvbiAmJiB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gPT09IFwib2JqZWN0XCIgJiYgXCJtdXRhdGlvblwiIGluIHNpZ25lZE11dGF0aW9uXG4gICAgICAgICAgICA/IC8qKiBAdHlwZSB7e211dGF0aW9uPzoge21vZGVsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fX0gKi8gKHNpZ25lZE11dGF0aW9uKS5tdXRhdGlvbj8ubW9kZWxcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpZGVtcG90ZW5jeUtleSxcbiAgICAgICAgICByZXNwb25zZTogYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dCksXG4gICAgICAgICAgc3RhdHVzOiBcImVycm9yXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzaWduZWQgcmVwbGF5IG11dGF0aW9ucyBmcm9tIHJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2lnbmVkIG11dGF0aW9uIGVudmVsb3Blcy5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9ucyhwYXJhbXMpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJhbXMubXV0YXRpb25zKSkgcmV0dXJuIHBhcmFtcy5tdXRhdGlvbnNcbiAgICBpZiAocGFyYW1zLm11dGF0aW9uKSByZXR1cm4gW3BhcmFtcy5tdXRhdGlvbl1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIG9yIG11dGF0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGFuZCByZXBsYXlzIG9uZSBzaWduZWQgc3luYyBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2lnbmVkTXV0YXRpb24gLSBTaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtyZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzZXJ2ZXJDaGFuZ2VGZWVkRXJyb3I/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNlcnZlckNoYW5nZUZlZWRTdGF0dXM/OiBcImVycm9yXCIsIHNlcnZlclNlcXVlbmNlOiBudW1iZXIgfCBudWxsfT59IC0gRnJvbnRlbmQtbW9kZWwgY29tbWFuZCByZXNwb25zZSBhbmQgYXBwZW5kZWQgc2VydmVyIHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkTXV0YXRpb24oc2lnbmVkTXV0YXRpb24pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBzeW5jQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGJhY2tlbmRQdWJsaWNLZXkgPSBzeW5jQ29uZmlndXJhdGlvbi5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXlcblxuICAgIGlmICghYmFja2VuZFB1YmxpY0tleSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgaXMgcmVxdWlyZWQgZm9yIHN5bmMgcmVwbGF5XCIpXG5cbiAgICBsZXQgbXV0YXRpb25cblxuICAgIHRyeSB7XG4gICAgICBtdXRhdGlvbiA9IGF3YWl0IHZlcmlmeVNpZ25lZE11dGF0aW9uKHtcbiAgICAgICAgYmFja2VuZFB1YmxpY0tleSxcbiAgICAgICAgc2lnbmVkTXV0YXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbilcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksIGVycm9yKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bmNNYW5pZmVzdCA9IGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHMoY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSlcbiAgICBjb25zdCBzeW5jUmVzb3VyY2UgPSBzeW5jTWFuaWZlc3RbbXV0YXRpb24ubW9kZWxdXG5cbiAgICBpZiAoIXN5bmNSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIGlmICghc3luY1Jlc291cmNlLm9wZXJhdGlvbnMuaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBvcGVyYXRpb24gaXMgbm90IGVuYWJsZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cbiAgICBpZiAoc3luY1Jlc291cmNlLnBvbGljeUhhc2ggIT09IG11dGF0aW9uLnBvbGljeUhhc2gpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgcG9saWN5IGhhc2ggbWlzbWF0Y2ggZm9yICR7bXV0YXRpb24ubW9kZWx9YClcbiAgICB9XG5cbiAgICBjb25zdCBzaWduZWRPZmZsaW5lR3JhbnQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE9mZmxpbmVHcmFudChzaWduZWRNdXRhdGlvbilcbiAgICBjb25zdCBvZmZsaW5lR3JhbnQgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtcbiAgICAgIHNpZ25lZE9mZmxpbmVHcmFudCxcbiAgICAgIHNpZ25pbmdLZXlzOiBzeW5jQ29uZmlndXJhdGlvbi5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuICAgIH0pXG5cbiAgICB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZhbGlkYXRlT2ZmbGluZUdyYW50KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jUmVzb3VyY2V9KVxuXG4gICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZFBhcmFtcyhtdXRhdGlvbilcbiAgICBjb25zdCByZXBsYXlDb21tYW5kID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kRm9yTXV0YXRpb24obXV0YXRpb24pXG5cbiAgICBsZXQgcmVzcG9uc2VcblxuICAgIHRyeSB7XG4gICAgICByZXNwb25zZSA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbW1hbmRQYXJhbXMsIHRoaXMucmVzcG9uc2UoKSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZCgvKiogQHR5cGUge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9ICovIChtdXRhdGlvbi5vcGVyYXRpb24pKSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDdXN0b21Db21tYW5kUGF5bG9hZCh7bXV0YXRpb24sIHJlcGxheUNvbW1hbmR9KSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgYWN0aW9uOiBcImZyb250ZW5kU3luY1JlcGxheVwiLFxuICAgICAgICBjb21tYW5kVHlwZTogLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlcGxheUNvbW1hbmQuY29tbWFuZFR5cGUpLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbW9kZWw6IG11dGF0aW9uLm1vZGVsXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVzcG9uc2U6IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLFxuICAgICAgICBzZXJ2ZXJTZXF1ZW5jZTogbnVsbFxuICAgICAgfVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jQXBwZW5kU2VydmVyQ2hhbmdlKHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IG11dGF0aW9uSWRlbXBvdGVuY3lLZXkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gKi8gKHNpZ25lZE11dGF0aW9uKSksXG4gICAgICAgIG11dGF0aW9uLFxuICAgICAgICBvZmZsaW5lR3JhbnQsXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4ge3Jlc3BvbnNlLCBzZXJ2ZXJTZXF1ZW5jZX1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICBhY3Rpb246IFwiZnJvbnRlbmRTeW5jUmVwbGF5XCIsXG4gICAgICAgIGNvbW1hbmRUeXBlOiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVwbGF5Q29tbWFuZC5jb21tYW5kVHlwZSksXG4gICAgICAgIGVycm9yLFxuICAgICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWxcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICByZXNwb25zZSxcbiAgICAgICAgc2VydmVyQ2hhbmdlRmVlZEVycm9yOiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSxcbiAgICAgICAgc2VydmVyQ2hhbmdlRmVlZFN0YXR1czogXCJlcnJvclwiLFxuICAgICAgICBzZXJ2ZXJTZXF1ZW5jZTogbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2lnbmVkIG9mZmxpbmUgZ3JhbnQgY2FycmllZCBieSBhIHJlcGxheSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzaWduZWRNdXRhdGlvbiAtIFNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkT2ZmbGluZUdyYW50KHNpZ25lZE11dGF0aW9uKSB7XG4gICAgaWYgKCFzaWduZWRNdXRhdGlvbiB8fCB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzaWduZWRNdXRhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIkV4cGVjdGVkIHN5bmMgcmVwbGF5IHNpZ25lZCBvZmZsaW5lIGdyYW50XCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc2lnbmVkTXV0YXRpb25SZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNpZ25lZE11dGF0aW9uKVxuICAgIGNvbnN0IHNpZ25lZE9mZmxpbmVHcmFudCA9IHNpZ25lZE11dGF0aW9uUmVjb3JkLnNpZ25lZE9mZmxpbmVHcmFudCB8fCBzaWduZWRNdXRhdGlvblJlY29yZC5vZmZsaW5lR3JhbnQgfHwgc2lnbmVkTXV0YXRpb25SZWNvcmQuc2lnbmVkR3JhbnRcblxuICAgIGlmICghc2lnbmVkT2ZmbGluZUdyYW50KSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJFeHBlY3RlZCBzeW5jIHJlcGxheSBzaWduZWQgb2ZmbGluZSBncmFudFwiKVxuXG4gICAgcmV0dXJuIHNpZ25lZE9mZmxpbmVHcmFudFxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGEgc3luYyByZXBsYXkgc2lnbmVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnNpZ25lZE9mZmxpbmVHcmFudCAtIFNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXlbXX0gYXJncy5zaWduaW5nS2V5cyAtIEF2YWlsYWJsZSBzaWduaW5nIGtleXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudD59IC0gVmVyaWZpZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtzaWduZWRPZmZsaW5lR3JhbnQsIHNpZ25pbmdLZXlzfSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdmVyaWZ5T2ZmbGluZUdyYW50KHtcbiAgICAgICAgbm93OiBuZXcgRGF0ZSgpLFxuICAgICAgICBzaWduZWRHcmFudDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5TaWduZWRPZmZsaW5lR3JhbnR9ICovIChzaWduZWRPZmZsaW5lR3JhbnQpLFxuICAgICAgICBzaWduaW5nS2V5c1xuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGF0IGEgdmVyaWZpZWQgb2ZmbGluZSBncmFudCBhdXRob3JpemVzIGEgcmVwbGF5ZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50fSBhcmdzLm9mZmxpbmVHcmFudCAtIFZlcmlmaWVkIGdyYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5zeW5jUmVzb3VyY2UgLSBDdXJyZW50IHN5bmMgcmVzb3VyY2UgZW50cnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIFRocm93cyB3aGVuIHVuYXV0aG9yaXplZC5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVZhbGlkYXRlT2ZmbGluZUdyYW50KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jUmVzb3VyY2V9KSB7XG4gICAgaWYgKG9mZmxpbmVHcmFudC5ncmFudElkICE9PSBtdXRhdGlvbi5vZmZsaW5lR3JhbnRJZCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwiU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cbiAgICBpZiAob2ZmbGluZUdyYW50LmRldmljZUlkICE9PSBtdXRhdGlvbi5hY3RvckRldmljZUlkKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IGRldmljZSBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cbiAgICBpZiAob2ZmbGluZUdyYW50LnVzZXJJZCAhPT0gbXV0YXRpb24uYWN0b3JVc2VySWQpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIlN5bmMgcmVwbGF5IG9mZmxpbmUgZ3JhbnQgdXNlciBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cblxuICAgIGNvbnN0IGdyYW50UmVzb3VyY2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKG9mZmxpbmVHcmFudC5yZXNvdXJjZXNbbXV0YXRpb24ubW9kZWxdKVxuICAgIGNvbnN0IGdyYW50T3BlcmF0aW9ucyA9IEFycmF5LmlzQXJyYXkoZ3JhbnRSZXNvdXJjZT8ub3BlcmF0aW9ucykgPyBncmFudFJlc291cmNlLm9wZXJhdGlvbnMgOiBbXVxuICAgIGNvbnN0IGdyYW50UG9saWN5SGFzaCA9IGdyYW50UmVzb3VyY2U/LnBvbGljeUhhc2hcblxuICAgIGlmICghZ3JhbnRSZXNvdXJjZSB8fCBncmFudFJlc291cmNlLmVuYWJsZWQgIT09IHRydWUpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIGlmICghZ3JhbnRPcGVyYXRpb25zLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH06ICR7bXV0YXRpb24ub3BlcmF0aW9ufWApXG4gICAgfVxuICAgIGlmIChncmFudFBvbGljeUhhc2ggIT09IG11dGF0aW9uLnBvbGljeUhhc2ggfHwgZ3JhbnRQb2xpY3lIYXNoICE9PSBzeW5jUmVzb3VyY2UucG9saWN5SGFzaCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHBvbGljeSBoYXNoIG1pc21hdGNoIGZvciAke211dGF0aW9uLm1vZGVsfWApXG4gICAgfVxuICAgIGlmICghb2ZmbGluZUdyYW50LnNjb3BlcyB8fCB0eXBlb2Ygb2ZmbGluZUdyYW50LnNjb3BlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudC5zY29wZXMpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHNjb3BlcyBhcmUgaW52YWxpZFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIGEgdmVyaWZpZWQgY3VzdG9tIHN5bmMgbXV0YXRpb24gdGhyb3VnaCB0aGUgcmVzb3VyY2UgY29tbWFuZCBBUEkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7e2NvbW1hbmRUeXBlOiBzdHJpbmcsIG1ldGhvZE5hbWU/OiBzdHJpbmcsIHNjb3BlPzogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifX0gYXJncy5yZXBsYXlDb21tYW5kIC0gUmVzb2x2ZWQgcmVwbGF5IGNvbW1hbmQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQ29tbWFuZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5Q3VzdG9tQ29tbWFuZFBheWxvYWQoe211dGF0aW9uLCByZXBsYXlDb21tYW5kfSkge1xuICAgIGlmICh0eXBlb2YgcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lICE9PSBcInN0cmluZ1wiIHx8IHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IGNvbW1hbmQgaXMgbm90IHJlZ2lzdGVyZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cblxuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICAubWFwKChiYWNrZW5kUHJvamVjdCkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IG11dGF0aW9uLm1vZGVsfSkpXG4gICAgICAuZmluZCgocmVzb3VyY2VDb25maWd1cmF0aW9uKSA9PiByZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSBuZXcgZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eTogdGhpcy5jdXJyZW50QWJpbGl0eSgpLFxuICAgICAgY29udHJvbGxlcjogdGhpcyxcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgLi4uKHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0Q29udGV4dCgpIHx8IHt9KSxcbiAgICAgICAgcGFyYW1zOiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgICAgcmVxdWVzdDogdGhpcy5yZXF1ZXN0KClcbiAgICAgIH0sXG4gICAgICBsb2NhbHM6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0TG9jYWxzKCkgfHwge30sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKSxcbiAgICAgIG1vZGVsTmFtZTogZnJvbnRlbmRNb2RlbFJlc291cmNlLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCksXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9KVxuICAgIGNvbnN0IGNvbW1hbmQgPSByZXNvdXJjZS5yZXNvdXJjZU1ldGhvZChyZXBsYXlDb21tYW5kLm1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIWNvbW1hbmQpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYE1pc3NpbmcgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgJyR7cmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lfScuYClcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kQXJndW1lbnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtdXRhdGlvbi5wYXlsb2FkICYmIHR5cGVvZiBtdXRhdGlvbi5wYXlsb2FkID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KG11dGF0aW9uLnBheWxvYWQpID8gbXV0YXRpb24ucGF5bG9hZCA6IHt9KVxuICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IGNvbW1hbmQubWV0aG9kLmNhbGwoY29tbWFuZC5yZXNvdXJjZSwgY29tbWFuZEFyZ3VtZW50cylcblxuICAgIGlmICghcmVzcG9uc2VQYXlsb2FkIHx8IHR5cGVvZiByZXNwb25zZVBheWxvYWQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChcbiAgICAgIGF3YWl0IHRoaXMuYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKFxuICAgICAgICByZXNwb25zZVBheWxvYWQsXG4gICAgICAgIC8qKiBAdHlwZSB7e3NlcmlhbGl6ZTogKG1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWN0aW9uOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19ICovIChjb21tYW5kLnJlc291cmNlKSxcbiAgICAgICAgcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lXG4gICAgICApXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBmcm9udGVuZC1tb2RlbCBjb21tYW5kIHBhcmFtcyBmb3IgYSB2ZXJpZmllZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IG11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gRnJvbnRlbmQtbW9kZWwgY29tbWFuZCBwYXJhbXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kUGFyYW1zKG11dGF0aW9uKSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IG11dGF0aW9uLnBheWxvYWQgJiYgdHlwZW9mIG11dGF0aW9uLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkobXV0YXRpb24ucGF5bG9hZCkgPyBtdXRhdGlvbi5wYXlsb2FkIDoge31cbiAgICBjb25zdCB7YXR0cmlidXRlcywgcHJpbWFyeUtleVZhbHVlfSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEF0dHJpYnV0ZXMobXV0YXRpb24pXG4gICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe1xuICAgICAgLi4ucGF5bG9hZCxcbiAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWxcbiAgICB9KVxuXG4gICAgaWYgKFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl0uaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgaWYgKG11dGF0aW9uLm9wZXJhdGlvbiAhPT0gXCJjcmVhdGVcIikge1xuICAgICAgICBjb25zdCBpZCA9IGNvbW1hbmRQYXJhbXMuaWQgfHwgY29tbWFuZFBhcmFtcy5yZWNvcmRJZCB8fCBwcmltYXJ5S2V5VmFsdWVcblxuICAgICAgICBpZiAodHlwZW9mIGlkICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSAke211dGF0aW9uLm9wZXJhdGlvbn0gcmVxdWlyZXMgYW4gaWRgKVxuXG4gICAgICAgIGNvbW1hbmRQYXJhbXMuaWQgPSBpZFxuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29tbWFuZFBhcmFtc1xuICAgIH1cblxuICAgIGNvbnN0IHJlcGxheUNvbW1hbmQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRGb3JNdXRhdGlvbihtdXRhdGlvbilcblxuICAgIGNvbW1hbmRQYXJhbXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRNZXRob2ROYW1lID0gcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lXG4gICAgY29tbWFuZFBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFNjb3BlID0gcmVwbGF5Q29tbWFuZC5zY29wZVxuXG4gICAgaWYgKHJlcGxheUNvbW1hbmQuc2NvcGUgPT09IFwibWVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IGlkID0gY29tbWFuZFBhcmFtcy5pZCB8fCBjb21tYW5kUGFyYW1zLnJlY29yZElkIHx8IHByaW1hcnlLZXlWYWx1ZVxuXG4gICAgICBpZiAodHlwZW9mIGlkICE9PSBcInN0cmluZ1wiICYmIHR5cGVvZiBpZCAhPT0gXCJudW1iZXJcIikgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSAke211dGF0aW9uLm9wZXJhdGlvbn0gcmVxdWlyZXMgYW4gaWRgKVxuXG4gICAgICBjb21tYW5kUGFyYW1zLmlkID0gaWRcbiAgICB9XG5cbiAgICByZXR1cm4gY29tbWFuZFBhcmFtc1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBmcm9udGVuZC1tb2RlbCBjb21tYW5kIHVzZWQgZm9yIGEgdmVyaWZpZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBtdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2NvbW1hbmRUeXBlOiBzdHJpbmcsIG1ldGhvZE5hbWU/OiBzdHJpbmcsIHNjb3BlPzogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifX0gLSBDb21tYW5kIG1ldGFkYXRhLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEZvck11dGF0aW9uKG11dGF0aW9uKSB7XG4gICAgaWYgKFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIl0uaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgcmV0dXJuIHtjb21tYW5kVHlwZTogbXV0YXRpb24ub3BlcmF0aW9ufVxuICAgIH1cblxuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICAubWFwKChiYWNrZW5kUHJvamVjdCkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IG11dGF0aW9uLm1vZGVsfSkpXG4gICAgICAuZmluZCgocmVzb3VyY2VDb25maWd1cmF0aW9uKSA9PiByZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuXG4gICAgY29uc3QgY29tbWFuZE5hbWUgPSB0eXBlb2YgbXV0YXRpb24uY29tbWFuZCA9PT0gXCJzdHJpbmdcIiAmJiBtdXRhdGlvbi5jb21tYW5kLmxlbmd0aCA+IDAgPyBtdXRhdGlvbi5jb21tYW5kIDogbXV0YXRpb24ub3BlcmF0aW9uXG4gICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvblxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZXNvdXJjZUNvbmZpZ3VyYXRpb24uY29sbGVjdGlvbkNvbW1hbmRzLCBjb21tYW5kTmFtZSkpIHtcbiAgICAgIHJldHVybiB7Y29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc2NvcGU6IFwiY29sbGVjdGlvblwifVxuICAgIH1cblxuICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocmVzb3VyY2VDb25maWd1cmF0aW9uLm1lbWJlckNvbW1hbmRzLCBjb21tYW5kTmFtZSkpIHtcbiAgICAgIHJldHVybiB7Y29tbWFuZFR5cGU6IGNvbW1hbmROYW1lLCBtZXRob2ROYW1lOiBjb21tYW5kTmFtZSwgc2NvcGU6IFwibWVtYmVyXCJ9XG4gICAgfVxuXG4gICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBjb21tYW5kIGlzIG5vdCByZWdpc3RlcmVkIGZvciAke211dGF0aW9uLm1vZGVsfTogJHtjb21tYW5kTmFtZX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGNvbW1hbmQgYXR0cmlidXRlcyBhbmQgcHJpbWFyeSBrZXkgZnJvbSBhIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBWZXJpZmllZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcHJpbWFyeUtleVZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCB1bmRlZmluZWR9Pn0gLSBDb21tYW5kIGF0dHJpYnV0ZXMgYW5kIHByaW1hcnkga2V5IHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEF0dHJpYnV0ZXMobXV0YXRpb24pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7Li4uKG11dGF0aW9uLmF0dHJpYnV0ZXMgfHwge30pfSlcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRCYWNrZW5kUHJvamVjdHMoKVxuICAgICAgLm1hcCgoYmFja2VuZFByb2plY3QpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxOYW1lOiBtdXRhdGlvbi5tb2RlbH0pKVxuICAgICAgLmZpbmQoKHJlc291cmNlQ29uZmlndXJhdGlvbikgPT4gcmVzb3VyY2VDb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVybiB7YXR0cmlidXRlcywgcHJpbWFyeUtleVZhbHVlOiB1bmRlZmluZWR9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdHlwZW9mIGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSA9PT0gXCJzdHJpbmdcIiA/IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24ucHJpbWFyeUtleSA6IFwiaWRcIlxuICAgIGNvbnN0IHByaW1hcnlLZXlBdHRyaWJ1dGUgPSBhdHRyaWJ1dGVzW3ByaW1hcnlLZXldXG4gICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gdHlwZW9mIHByaW1hcnlLZXlBdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHByaW1hcnlLZXlBdHRyaWJ1dGUgPT09IFwibnVtYmVyXCIgPyBwcmltYXJ5S2V5QXR0cmlidXRlIDogdW5kZWZpbmVkXG5cbiAgICBpZiAocHJpbWFyeUtleVZhbHVlICE9PSB1bmRlZmluZWQgJiYgbXV0YXRpb24ub3BlcmF0aW9uICE9PSBcImNyZWF0ZVwiKSBkZWxldGUgYXR0cmlidXRlc1twcmltYXJ5S2V5XVxuXG4gICAgcmV0dXJuIHthdHRyaWJ1dGVzLCBwcmltYXJ5S2V5VmFsdWV9XG4gIH1cblxuICAvKipcbiAgICogQXBwZW5kcyBhIHN1Y2Nlc3NmdWxseSByZXBsYXllZCBtdXRhdGlvbiB0byB0aGUgc2VydmVyIGNoYW5nZSBmZWVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBhcmdzLmlkZW1wb3RlbmN5S2V5IC0gTXV0YXRpb24gaWRlbXBvdGVuY3kga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50fSBhcmdzLm9mZmxpbmVHcmFudCAtIFZlcmlmaWVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnJlc3BvbnNlIC0gUmVwbGF5IGNvbW1hbmQgcmVzcG9uc2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIEFzc2lnbmVkIHNlcnZlciBzZXF1ZW5jZSwgb3IgbnVsbCB3aGVuIG5vIGNoYW5nZSB3YXMgYXBwZW5kZWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNBcHBlbmRTZXJ2ZXJDaGFuZ2Uoe2lkZW1wb3RlbmN5S2V5LCBtdXRhdGlvbiwgb2ZmbGluZUdyYW50LCByZXNwb25zZX0pIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSBcInN1Y2Nlc3NcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHN0b3JlID0gc2VydmVyQ2hhbmdlRmVlZFN0b3JlRm9yQ29uZmlndXJhdGlvbih0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICBjb25zdCByZXNwb25zZVN5bmNDaGFuZ2VzID0gQXJyYXkuaXNBcnJheShyZXNwb25zZS5zeW5jQ2hhbmdlcykgPyByZXNwb25zZS5zeW5jQ2hhbmdlcyA6IFtdXG4gICAgY29uc3Qgc3luY0NoYW5nZXMgPSByZXNwb25zZVN5bmNDaGFuZ2VzLmxlbmd0aCA+IDAgPyByZXNwb25zZVN5bmNDaGFuZ2VzIDogW3tcbiAgICAgIGF0dHJpYnV0ZXM6IG11dGF0aW9uLmF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWwsXG4gICAgICBvcGVyYXRpb246IG11dGF0aW9uLm9wZXJhdGlvbixcbiAgICAgIHBheWxvYWQ6IG11dGF0aW9uLnBheWxvYWRcbiAgICB9XVxuICAgIGxldCBzZXJ2ZXJTZXF1ZW5jZSA9IC8qKiBAdHlwZSB7bnVtYmVyIHwgbnVsbH0gKi8gKG51bGwpXG5cbiAgICBmb3IgKGNvbnN0IHN5bmNDaGFuZ2Ugb2Ygc3luY0NoYW5nZXMpIHtcbiAgICAgIGlmICghc3luY0NoYW5nZSB8fCB0eXBlb2Ygc3luY0NoYW5nZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHN5bmNDaGFuZ2UpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjaGFuZ2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN5bmNDaGFuZ2UpXG4gICAgICBjb25zdCBwYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChjaGFuZ2UucGF5bG9hZCAmJiB0eXBlb2YgY2hhbmdlLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoY2hhbmdlLnBheWxvYWQpID8gY2hhbmdlLnBheWxvYWQgOiB7fSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNoYW5nZS5hdHRyaWJ1dGVzICYmIHR5cGVvZiBjaGFuZ2UuYXR0cmlidXRlcyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjaGFuZ2UuYXR0cmlidXRlcykgPyBjaGFuZ2UuYXR0cmlidXRlcyA6IHt9KVxuICAgICAgY29uc3QgbW9kZWwgPSB0eXBlb2YgY2hhbmdlLm1vZGVsID09PSBcInN0cmluZ1wiICYmIGNoYW5nZS5tb2RlbC5sZW5ndGggPiAwID8gY2hhbmdlLm1vZGVsIDogbXV0YXRpb24ubW9kZWxcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IHR5cGVvZiBjaGFuZ2Uub3BlcmF0aW9uID09PSBcInN0cmluZ1wiICYmIGNoYW5nZS5vcGVyYXRpb24ubGVuZ3RoID4gMCA/IGNoYW5nZS5vcGVyYXRpb24gOiBtdXRhdGlvbi5vcGVyYXRpb25cbiAgICAgIGNvbnN0IHJhd1JlY29yZElkID0gY2hhbmdlLnJlY29yZElkID8/IHBheWxvYWQuaWQgPz8gcGF5bG9hZC5yZWNvcmRJZCA/PyBhdHRyaWJ1dGVzLmlkID8/IG51bGxcbiAgICAgIGNvbnN0IHJlY29yZElkID0gcmF3UmVjb3JkSWQgPT09IG51bGwgfHwgcmF3UmVjb3JkSWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocmF3UmVjb3JkSWQpXG4gICAgICBjb25zdCBhcHBlbmRlZENoYW5nZSA9IGF3YWl0IHN0b3JlLmFwcGVuZCh7XG4gICAgICAgIGFjdG9yRGV2aWNlSWQ6IG11dGF0aW9uLmFjdG9yRGV2aWNlSWQsXG4gICAgICAgIGFjdG9yVXNlcklkOiBtdXRhdGlvbi5hY3RvclVzZXJJZCxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgIG1vZGVsLFxuICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHJlY29yZElkLFxuICAgICAgICByZXNwb25zZSxcbiAgICAgICAgc2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXNcbiAgICAgIH0pXG5cbiAgICAgIHNlcnZlclNlcXVlbmNlID0gYXBwZW5kZWRDaGFuZ2Uuc2VydmVyU2VxdWVuY2VcbiAgICB9XG5cbiAgICByZXR1cm4gc2VydmVyU2VxdWVuY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyB0aGUgc2lnbmVkIG9mZmxpbmUgZ3JhbnQgdXNlZCB0byBzY29wZSBzeW5jIHJlYWQgZW5kcG9pbnRzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudD59IC0gVmVyaWZpZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcXVlc3RWZXJpZmllZE9mZmxpbmVHcmFudChwYXJhbXMpIHtcbiAgICBjb25zdCBzaWduZWRPZmZsaW5lR3JhbnQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE9mZmxpbmVHcmFudChwYXJhbXMpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlWZXJpZmllZE9mZmxpbmVHcmFudCh7XG4gICAgICBzaWduZWRPZmZsaW5lR3JhbnQsXG4gICAgICBzaWduaW5nS2V5czogdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0U3luY0NvbmZpZ3VyYXRpb24oKS5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBzeW5jIGNoYW5nZSBmZWVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIGNoYW5nZS1mZWVkIHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHRoaXMucGFyYW1zKCkpKVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVxdWVzdFZlcmlmaWVkT2ZmbGluZUdyYW50KHBhcmFtcylcbiAgICBjb25zdCBhZnRlclNlcXVlbmNlID0gdGhpcy5mcm9udGVuZFN5bmNDaGFuZ2VGZWVkQWZ0ZXJTZXF1ZW5jZShwYXJhbXMpXG4gICAgY29uc3Qgc3RvcmUgPSBzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5mcm9udGVuZFN5bmNDaGFuZ2VGZWVkTGltaXQocGFyYW1zKVxuICAgIGNvbnN0IGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSA9IGF3YWl0IHN0b3JlLmxhdGVzdFNlcXVlbmNlKClcbiAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZSA9IHRoaXMuZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZFVwVG9TZXF1ZW5jZShwYXJhbXMsIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSlcbiAgICBjb25zdCBwYWdlID0gYXdhaXQgc3RvcmUuY2hhbmdlc0FmdGVyKHthZnRlclNlcXVlbmNlLCBsaW1pdCwgc2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXMsIHVwVG9TZXF1ZW5jZTogc2VydmVyU2VxdWVuY2V9KVxuXG4gICAgaWYgKHBhZ2Uuc25hcHNob3RSZXF1aXJlZCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgICAgY2hhbmdlczogW10sXG4gICAgICAgICAgb2xkZXN0U2VxdWVuY2U6IHBhZ2Uub2xkZXN0U2VxdWVuY2UsXG4gICAgICAgICAgcmVxdWVzdGVkQWZ0ZXJTZXF1ZW5jZTogYWZ0ZXJTZXF1ZW5jZSxcbiAgICAgICAgICBzZXJ2ZXJTZXF1ZW5jZSxcbiAgICAgICAgICBzbmFwc2hvdDogYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzLCBzZXJ2ZXJTZXF1ZW5jZX0pLFxuICAgICAgICAgIHN0YXR1czogXCJzbmFwc2hvdF9yZXF1aXJlZFwiXG4gICAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY2hhbmdlcyA9IHBhZ2UuY2hhbmdlc1xuICAgIGNvbnN0IGluY2x1ZGVTbmFwc2hvdCA9IHBhcmFtcy5zbmFwc2hvdCA9PT0gdHJ1ZSB8fCBwYXJhbXMuaW5jbHVkZVNuYXBzaG90ID09PSB0cnVlIHx8IGFmdGVyU2VxdWVuY2UgPT09IDBcbiAgICBjb25zdCBzbmFwc2hvdCA9IGluY2x1ZGVTbmFwc2hvdCA/IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jU25hcHNob3RQYXlsb2FkKHtzY29wZTogb2ZmbGluZUdyYW50LnNjb3Blcywgc2VydmVyU2VxdWVuY2V9KSA6IHVuZGVmaW5lZFxuXG4gICAgY29uc3QgcGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe1xuICAgICAgY2hhbmdlcyxcbiAgICAgIGhhc01vcmU6IHBhZ2UuaGFzTW9yZSxcbiAgICAgIG5leHRTZXF1ZW5jZTogcGFnZS5uZXh0U2VxdWVuY2UsXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZSxcbiAgICAgIHN0YXR1czogXCJzdWNjZXNzXCIsXG4gICAgICB1cFRvU2VxdWVuY2U6IHBhZ2UudXBUb1NlcXVlbmNlXG4gICAgfSlcblxuICAgIGlmIChzbmFwc2hvdCkgcGF5bG9hZC5zbmFwc2hvdCA9IHNuYXBzaG90XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShwYXlsb2FkLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc3luYyBjaGFuZ2UtZmVlZCBjdXJzb3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBFeGNsdXNpdmUgbG93ZXItYm91bmQgc2VxdWVuY2UuXG4gICAqL1xuICBmcm9udGVuZFN5bmNDaGFuZ2VGZWVkQWZ0ZXJTZXF1ZW5jZShwYXJhbXMpIHtcbiAgICBjb25zdCBhZnRlclNlcXVlbmNlID0gcGFyYW1zLmFmdGVyU2VxdWVuY2UgPz8gcGFyYW1zLmN1cnNvciA/PyAwXG5cbiAgICBpZiAodHlwZW9mIGFmdGVyU2VxdWVuY2UgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcihhZnRlclNlcXVlbmNlKSAmJiBhZnRlclNlcXVlbmNlID49IDApIHJldHVybiBhZnRlclNlcXVlbmNlXG4gICAgaWYgKHR5cGVvZiBhZnRlclNlcXVlbmNlID09PSBcInN0cmluZ1wiICYmIC9eXFxkKyQvLnRlc3QoYWZ0ZXJTZXF1ZW5jZSkpIHJldHVybiBOdW1iZXIoYWZ0ZXJTZXF1ZW5jZSlcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgY2hhbmdlLWZlZWQgYWZ0ZXJTZXF1ZW5jZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgY2hhbmdlLWZlZWQgcGFnZSBsaW1pdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFBhZ2UgbGltaXQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNDaGFuZ2VGZWVkTGltaXQocGFyYW1zKSB7XG4gICAgY29uc3QgbGltaXQgPSBwYXJhbXMubGltaXQgPz8gcGFyYW1zLnBhZ2VTaXplID8/IDEwMFxuXG4gICAgaWYgKHR5cGVvZiBsaW1pdCA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKGxpbWl0KSAmJiBsaW1pdCA+IDApIHJldHVybiBsaW1pdFxuICAgIGlmICh0eXBlb2YgbGltaXQgPT09IFwic3RyaW5nXCIgJiYgL15cXGQrJC8udGVzdChsaW1pdCkpIHJldHVybiBOdW1iZXIobGltaXQpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGNoYW5nZS1mZWVkIHBvc2l0aXZlIGxpbWl0XCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc3luYyBjaGFuZ2UtZmVlZCBzdGFibGUgaGlnaC13YXRlciBtYXJrLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBjdXJyZW50U2VydmVyU2VxdWVuY2UgLSBDdXJyZW50IGxhdGVzdCBzZXJ2ZXIgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gSW5jbHVzaXZlIHVwcGVyLWJvdW5kIHNlcXVlbmNlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQ2hhbmdlRmVlZFVwVG9TZXF1ZW5jZShwYXJhbXMsIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSkge1xuICAgIGNvbnN0IHVwVG9TZXF1ZW5jZSA9IHBhcmFtcy51cFRvU2VxdWVuY2UgPz8gcGFyYW1zLnNlcnZlclNlcXVlbmNlID8/IGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZVxuXG4gICAgaWYgKHR5cGVvZiB1cFRvU2VxdWVuY2UgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcih1cFRvU2VxdWVuY2UpICYmIHVwVG9TZXF1ZW5jZSA+PSAwKSByZXR1cm4gTWF0aC5taW4odXBUb1NlcXVlbmNlLCBjdXJyZW50U2VydmVyU2VxdWVuY2UpXG4gICAgaWYgKHR5cGVvZiB1cFRvU2VxdWVuY2UgPT09IFwic3RyaW5nXCIgJiYgL15cXGQrJC8udGVzdCh1cFRvU2VxdWVuY2UpKSByZXR1cm4gTWF0aC5taW4oTnVtYmVyKHVwVG9TZXF1ZW5jZSksIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSlcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgY2hhbmdlLWZlZWQgdXBUb1NlcXVlbmNlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBzeW5jIHNuYXBzaG90IGVuZHBvaW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIHNuYXBzaG90IHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jU25hcHNob3QoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCBvZmZsaW5lR3JhbnQgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcXVlc3RWZXJpZmllZE9mZmxpbmVHcmFudChwYXJhbXMpXG4gICAgY29uc3Qgc3RvcmUgPSBzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IHNlcnZlclNlcXVlbmNlID0gYXdhaXQgc3RvcmUubGF0ZXN0U2VxdWVuY2UoKVxuICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzLCBzZXJ2ZXJTZXF1ZW5jZX0pXG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIHNuYXBzaG90LFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc25hcHNob3Qgb2Ygc3luYy1lbmFibGVkIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcyBhdCBhIHN0YWJsZSBzZXJ2ZXIgc2VxdWVuY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5zZXJ2ZXJTZXF1ZW5jZSAtIFNuYXBzaG90IHNlcXVlbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Muc2NvcGVdIC0gQ2FsbGVyIHN5bmMgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtyZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc2VydmVyU2VxdWVuY2U6IG51bWJlcn0+fSAtIFNuYXBzaG90IHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlLCBzZXJ2ZXJTZXF1ZW5jZX0pIHtcbiAgICBjb25zdCBzeW5jTWFuaWZlc3QgPSBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpKVxuICAgIGNvbnN0IHJlc291cmNlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe30pXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsTmFtZSBvZiBPYmplY3Qua2V5cyhzeW5jTWFuaWZlc3QpLnNvcnQoKSkge1xuICAgICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IHsuLi4oc2NvcGUgfHwge30pLCBtb2RlbDogbW9kZWxOYW1lfVxuXG4gICAgICByZXNvdXJjZXNbbW9kZWxOYW1lXSA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbW1hbmRQYXJhbXMsIHRoaXMucmVzcG9uc2UoKSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZChcImluZGV4XCIpIHx8IHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkFjdGlvbiBoYWx0ZWQgYnkgYmVmb3JlQWN0aW9uLlwiKVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4ge3Jlc291cmNlcywgc2VydmVyU2VxdWVuY2V9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhcGkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFNoYXJlZCBmcm9udGVuZCBtb2RlbCBBUEkgYWN0aW9uIHdpdGggYmF0Y2ggc3VwcG9ydC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXBpKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3QgcmVxdWVzdHMgPSBBcnJheS5pc0FycmF5KHBhcmFtcy5yZXF1ZXN0cykgPyBwYXJhbXMucmVxdWVzdHMgOiBbcGFyYW1zXVxuICAgIC8qKlxuICAgICAqIFJlc3BvbnNlcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCByZXNwb25zZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCByZXF1ZXN0RW50cnkgb2YgcmVxdWVzdHMpIHtcbiAgICAgIGNvbnN0IGNvbW1hbmRUeXBlID0gcmVxdWVzdEVudHJ5Py5jb21tYW5kVHlwZVxuICAgICAgY29uc3QgY3VzdG9tUGF0aCA9IHJlcXVlc3RFbnRyeT8uY3VzdG9tUGF0aFxuICAgICAgY29uc3QgbW9kZWwgPSByZXF1ZXN0RW50cnk/Lm1vZGVsXG4gICAgICBjb25zdCBwYXlsb2FkID0gcmVxdWVzdEVudHJ5Py5wYXlsb2FkXG4gICAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0RW50cnk/LnJlcXVlc3RJZFxuXG4gICAgICBpZiAodHlwZW9mIG1vZGVsICE9PSBcInN0cmluZ1wiIHx8IG1vZGVsLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgcmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXNwb25zZTogdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgcmVxdWVzdCBtb2RlbC5cIilcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgaXNCdWlsdEluQ29tbWFuZCA9IFtcImluZGV4XCIsIFwiZmluZFwiLCBcImNyZWF0ZVwiLCBcInVwZGF0ZVwiLCBcImRlc3Ryb3lcIiwgXCJhdHRhY2hcIiwgXCJkb3dubG9hZFwiLCBcInVybFwiLCBcImF0dGFjaG1lbnRMaXN0XCJdLmluY2x1ZGVzKGNvbW1hbmRUeXBlKVxuXG4gICAgICBpZiAoIWlzQnVpbHRJbkNvbW1hbmQgJiYgKHR5cGVvZiBjdXN0b21QYXRoICE9PSBcInN0cmluZ1wiIHx8ICFjdXN0b21QYXRoLnN0YXJ0c1dpdGgoXCIvXCIpKSkge1xuICAgICAgICByZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHJlc3BvbnNlOiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCByZXF1ZXN0IGN1c3RvbVBhdGguXCIpXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RDb250ZXh0ID0gY2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChyZXF1ZXN0RW50cnk/LnJlcXVlc3RDb250ZXh0KVxuICAgICAgICBsZXQgcmVzcG9uc2VQYXlsb2FkXG5cbiAgICAgICAgaWYgKGlzQnVpbHRJbkNvbW1hbmQpIHtcbiAgICAgICAgICBjb25zdCBjb21tYW5kUGFyYW1zID0gbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHQoXG4gICAgICAgICAgICByZXF1ZXN0Q29udGV4dCxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgLi4uKHBheWxvYWQgJiYgdHlwZW9mIHBheWxvYWQgPT09IFwib2JqZWN0XCIgPyBwYXlsb2FkIDoge30pLFxuICAgICAgICAgICAgICBtb2RlbFxuICAgICAgICAgICAgfVxuICAgICAgICAgIClcblxuICAgICAgICAgIHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChjb21tYW5kUGFyYW1zLCB0aGlzLnJlc3BvbnNlKCksIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbW1hbmRQYXlsb2FkKGNvbW1hbmRUeXBlKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRBcGlDdXN0b21Db21tYW5kUGF5bG9hZCh7XG4gICAgICAgICAgICBjdXN0b21QYXRoLFxuICAgICAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgICAgIHJlcXVlc3RDb250ZXh0XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVzcG9uc2U6IHJlc3BvbnNlUGF5bG9hZCB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgICBhY3Rpb246IFwiZnJvbnRlbmRBcGlcIixcbiAgICAgICAgICBjb21tYW5kVHlwZSxcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICBtb2RlbCxcbiAgICAgICAgICByZXF1ZXN0SWRcbiAgICAgICAgfSlcblxuICAgICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgICByZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHJlc3BvbnNlOiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHtcbiAgICAgICAgcmVzcG9uc2VzLFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRGlzcGF0Y2hlcyBhIGN1c3RvbSBmcm9udGVuZC1tb2RlbCBjb21tYW5kIHRocm91Z2ggdGhlIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUEkgZW5kcG9pbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jdXN0b21QYXRoIC0gQ3VzdG9tIGJhY2tlbmQgcm91dGUgcGF0aC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5wYXlsb2FkIC0gUmVxdWVzdCBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcmVtb3RlLXJlcXVlc3QtY29udGV4dC5qc1wiKS5SZW1vdGVSZXF1ZXN0Q29udGV4dH0gYXJncy5yZXF1ZXN0Q29udGV4dCAtIENhcHR1cmVkIHJlbW90ZSByZXF1ZXN0IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUGFyc2VkIEpTT04gcmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXBpQ3VzdG9tQ29tbWFuZFBheWxvYWQoe2N1c3RvbVBhdGgsIHBheWxvYWQsIHJlcXVlc3RDb250ZXh0fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKHtjb25maWd1cmF0aW9ufSlcbiAgICBjb25zdCByZXNvbHZlciA9IG5ldyBSb3V0ZXNSZXNvbHZlcih7XG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgcmVxdWVzdDogdGhpcy5nZXRSZXF1ZXN0KCksXG4gICAgICByZXNwb25zZVxuICAgIH0pXG4gICAgcmVzb2x2ZXIucGFyYW1zID0ge31cbiAgICBjb25zdCByb3V0ZUhvb2tNYXRjaCA9IGF3YWl0IHJlc29sdmVyLnJlc29sdmVSb3V0ZVJlc29sdmVySG9va3MoY3VzdG9tUGF0aClcbiAgICBjb25zdCBjb25maWd1cmF0aW9uUm91dGVzID0gY29uZmlndXJhdGlvbi5nZXRSb3V0ZXMoKVxuICAgIGNvbnN0IHJvdXRlTWF0Y2ggPSByb3V0ZUhvb2tNYXRjaCB8fCAhY29uZmlndXJhdGlvblJvdXRlcz8ucm9vdFJvdXRlID8gdW5kZWZpbmVkIDogcmVzb2x2ZXIubWF0Y2hQYXRoV2l0aFJvdXRlcyhjb25maWd1cmF0aW9uUm91dGVzLnJvb3RSb3V0ZSwgY3VzdG9tUGF0aClcblxuICAgIGlmICghcm91dGVIb29rTWF0Y2ggJiYgIXJvdXRlTWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gY3VzdG9tIGZyb250ZW5kIG1vZGVsIHJvdXRlIG1hdGNoZWQgJyR7Y3VzdG9tUGF0aH0nYClcbiAgICB9XG5cbiAgICBjb25zdCBhY3Rpb25QYXJhbSA9IHJvdXRlSG9va01hdGNoPy5hY3Rpb24gfHwgcmVzb2x2ZXIucGFyYW1zLmFjdGlvblxuICAgIGNvbnN0IGNvbnRyb2xsZXJQYXJhbSA9IHJvdXRlSG9va01hdGNoPy5jb250cm9sbGVyIHx8IHJlc29sdmVyLnBhcmFtcy5jb250cm9sbGVyXG4gICAgY29uc3QgYWN0aW9uVmFsdWUgPSB0eXBlb2YgYWN0aW9uUGFyYW0gPT09IFwic3RyaW5nXCIgPyBhY3Rpb25QYXJhbSA6IChBcnJheS5pc0FycmF5KGFjdGlvblBhcmFtKSA/IGFjdGlvblBhcmFtWzBdIDogdW5kZWZpbmVkKVxuICAgIGNvbnN0IGNvbnRyb2xsZXJWYWx1ZSA9IHR5cGVvZiBjb250cm9sbGVyUGFyYW0gPT09IFwic3RyaW5nXCIgPyBjb250cm9sbGVyUGFyYW0gOiAoQXJyYXkuaXNBcnJheShjb250cm9sbGVyUGFyYW0pID8gY29udHJvbGxlclBhcmFtWzBdIDogdW5kZWZpbmVkKVxuXG4gICAgaWYgKHR5cGVvZiBhY3Rpb25WYWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCBhY3Rpb25WYWx1ZS5sZW5ndGggPCAxIHx8IHR5cGVvZiBjb250cm9sbGVyVmFsdWUgIT09IFwic3RyaW5nXCIgfHwgY29udHJvbGxlclZhbHVlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ3VzdG9tIGZyb250ZW5kIG1vZGVsIHJvdXRlIG1hdGNoZWQgJyR7Y3VzdG9tUGF0aH0nIHdpdGhvdXQgY29udHJvbGxlci9hY3Rpb24gcGFyYW1zYClcbiAgICB9XG5cbiAgICBjb25zdCBhY3Rpb24gPSBpbmZsZWN0aW9uLmNhbWVsaXplKGFjdGlvblZhbHVlLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKS5yZXBsYWNlQWxsKFwiL1wiLCBcIl9cIiksIHRydWUpXG4gICAgY29uc3QgY29udHJvbGxlciA9IGNvbnRyb2xsZXJWYWx1ZVxuICAgIGNvbnN0IGNvbnRyb2xsZXJQYXRoID0gcm91dGVIb29rTWF0Y2g/LmNvbnRyb2xsZXJQYXRoIHx8IGAke2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9yb3V0ZXMvJHtjb250cm9sbGVyfS9jb250cm9sbGVyLmpzYFxuICAgIGNvbnN0IHZpZXdQYXRoID0gcm91dGVIb29rTWF0Y2g/LnZpZXdQYXRoIHx8IGAke2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9yb3V0ZXMvJHtjb250cm9sbGVyfWBcbiAgICByZXNvbHZlci5yb3V0ZUhvb2tDb250cm9sbGVyQ2xhc3MgPSByb3V0ZUhvb2tNYXRjaD8uY29udHJvbGxlckNsYXNzXG4gICAgY29uc3QgY29udHJvbGxlckNsYXNzID0gYXdhaXQgcmVzb2x2ZXIucmVzb2x2ZUNvbnRyb2xsZXJDbGFzcyh7Y29udHJvbGxlclBhdGh9KVxuICAgIGNvbnN0IGNvbnRyb2xsZXJQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChcbiAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAge1xuICAgICAgICAuLi4oKHBheWxvYWQgJiYgdHlwZW9mIHBheWxvYWQgPT09IFwib2JqZWN0XCIpID8gcGF5bG9hZCA6IHt9KSxcbiAgICAgICAgLi4ucmVzb2x2ZXIucGFyYW1zXG4gICAgICB9XG4gICAgKVxuICAgIGNvbnN0IGNvbnRyb2xsZXJJbnN0YW5jZSA9IG5ldyBjb250cm9sbGVyQ2xhc3Moe1xuICAgICAgYWN0aW9uLFxuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIGNvbnRyb2xsZXIsXG4gICAgICBwYXJhbXM6IGNvbnRyb2xsZXJQYXJhbXMsXG4gICAgICByZXF1ZXN0OiAvKiogQHR5cGUge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMuZ2V0UmVxdWVzdCgpKSxcbiAgICAgIHJlc3BvbnNlLFxuICAgICAgdmlld1BhdGhcbiAgICB9KVxuXG4gICAgLy8gUHJlc2VydmUgdGhlIGNsaWVudCdzIG93biBjb21tYW5kIGFyZ3VtZW50cyBiZWZvcmUgcm91dGUgZnJhbWV3b3JrIHBhcmFtcyB3b25cbiAgICAvLyB0aGUgYGNvbnRyb2xsZXJQYXJhbXNgIG1lcmdlIGFib3ZlLCBzbyBhIHR5cGVkIGNvbW1hbmQgbWV0aG9kIChgYXN5bmMgbmFtZShhcmdzKWApXG4gICAgLy8gcmVjZWl2ZXMgdGhlIGNsaWVudCBwYXlsb2FkIOKAlCBub3QgdGhlIHJvdXRlJ3MgbWVtYmVyIGlkIC8gbW9kZWwgLyBjb250cm9sbGVyIGtleXMuXG4gICAgY29uc3QgY3VzdG9tQ29tbWFuZENvbnRyb2xsZXIgPSAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxDb250cm9sbGVyfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoY29udHJvbGxlckluc3RhbmNlKSlcblxuICAgIGN1c3RvbUNvbW1hbmRDb250cm9sbGVyLl9mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZENsaWVudEFyZ3VtZW50cyA9XG4gICAgICAocGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShwYXlsb2FkKSkgPyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpIDoge31cblxuICAgIGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxSZXF1ZXN0Q29udGV4dChjb250cm9sbGVyUGFyYW1zLCByZXNwb25zZSwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY29udHJvbGxlckluc3RhbmNlLl9ydW5CZWZvcmVDYWxsYmFja3MoKVxuICAgICAgY29uc3QgY29udHJvbGxlck1ldGhvZHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICgpID0+IFByb21pc2U8dm9pZD4gfCB2b2lkPn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChjb250cm9sbGVySW5zdGFuY2UpKVxuXG4gICAgICBhd2FpdCBjb250cm9sbGVyTWV0aG9kc1thY3Rpb25dKClcbiAgICB9KVxuXG4gICAgY29uc3Qgc2V0Q29va2llSGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnNbXCJTZXQtQ29va2llXCJdIHx8IFtdXG5cbiAgICBmb3IgKGNvbnN0IHNldENvb2tpZUhlYWRlciBvZiBzZXRDb29raWVIZWFkZXJzKSB7XG4gICAgICB0aGlzLnJlc3BvbnNlKCkuYWRkSGVhZGVyKFwiU2V0LUNvb2tpZVwiLCBzZXRDb29raWVIZWFkZXIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gcmVzcG9uc2UuZ2V0Qm9keSgpXG5cbiAgICBpZiAodHlwZW9mIHJlc3BvbnNlQm9keSAhPT0gXCJzdHJpbmdcIiB8fCByZXNwb25zZUJvZHkubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuXG4gICAgLy8gUHJlc2VydmUgbmVzdGVkIHRyYW5zcG9ydCBtYXJrZXJzIHNvIHRoZSBvdXRlciBzaGFyZWQgZnJvbnRlbmQtbW9kZWwgQVBJXG4gICAgLy8gY2FuIHJldHVybiB0aGVtIHVuY2hhbmdlZCBhbmQgbGV0IHRoZSBjbGllbnQgaHlkcmF0ZSBvbmNlIGF0IHRoZSBlZGdlLlxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKEpTT04ucGFyc2UocmVzcG9uc2VCb2R5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGluZGV4LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBDb2xsZWN0aW9uIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRJbmRleCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJpbmRleFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgZmluZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGZpbmQgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEZpbmQoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiZmluZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgdXBkYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgdXBkYXRlIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRVcGRhdGUoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwidXBkYXRlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBhdHRhY2guXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBhdHRhY2ggYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEF0dGFjaCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJhdHRhY2hcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGRvd25sb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgZG93bmxvYWQgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZERvd25sb2FkKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImRvd25sb2FkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCB1cmwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBVUkwgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFVybCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJ1cmxcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGNyZWF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGNyZWF0ZSBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQ3JlYXRlKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImNyZWF0ZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgZGVzdHJveS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGRlc3Ryb3kgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZERlc3Ryb3koKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiZGVzdHJveVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgY3VzdG9tIGNvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIEN1c3RvbSBjb2xsZWN0aW9uL21lbWJlciBjb21tYW5kIGFjdGlvbiBmb3IgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRDdXN0b21Db21tYW5kKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZVBheWxvYWQgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kUGF5bG9hZCgpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUocmVzcG9uc2VQYXlsb2FkLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe2FjdGlvbjogXCJmcm9udGVuZEN1c3RvbUNvbW1hbmRcIiwgY29tbWFuZFR5cGU6IFwiY3VzdG9tLWNvbW1hbmRcIiwgZXJyb3J9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY3VzdG9tIGNvbW1hbmQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBSZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXlsb2FkKCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IHBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZE1ldGhvZE5hbWVcbiAgICBjb25zdCBzY29wZSA9IHBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFNjb3BlXG5cbiAgICBpZiAodHlwZW9mIG1ldGhvZE5hbWUgIT09IFwic3RyaW5nXCIgfHwgbWV0aG9kTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgbWV0aG9kIG5hbWUuXCIpXG4gICAgfVxuXG4gICAgaWYgKHNjb3BlICE9PSBcImNvbGxlY3Rpb25cIiAmJiBzY29wZSAhPT0gXCJtZW1iZXJcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIGZyb250ZW5kLW1vZGVsIGN1c3RvbSBjb21tYW5kIHNjb3BlLlwiKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpXG4gICAgY29uc3QgY29tbWFuZCA9IHJlc291cmNlLnJlc291cmNlTWV0aG9kKG1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIWNvbW1hbmQpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYE1pc3NpbmcgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgJyR7bWV0aG9kTmFtZX0nLmApXG4gICAgfVxuXG4gICAgLy8gUGFzcyB0aGUgY2xpZW50IGNvbW1hbmQgYXJndW1lbnRzIGFzIHRoZSBtZXRob2QncyBmaXJzdCBhcmd1bWVudCBzbyBhIGNvbW1hbmRcbiAgICAvLyBtZXRob2QgY2FuIHRha2UgYSB0eXBlZCBhcmdzIG9iamVjdCAoYGFzeW5jIG5hbWUoYXJncylgKSBhbmQgdGhlIGdlbmVyYXRlZFxuICAgIC8vIGZyb250ZW5kIG1ldGhvZCBjYW4gZm9yd2FyZCB0aGUgYmFja2VuZCBtZXRob2QncyBgQHBhcmFtYC4gYHRoaXMucGFyYW1zKClgIGlzXG4gICAgLy8gdW5jaGFuZ2VkLCBzbyBleGlzdGluZyBwYXJhbWV0ZXJsZXNzIG1ldGhvZHMga2VlcCB3b3JraW5nLiBUaGUgYXJncyBhcmUgdW50cnVzdGVkXG4gICAgLy8gY2xpZW50IGlucHV0IHR5cGVkIG9ubHkgYnkgdGhlIGRlY2xhcmVkIGNvbnRyYWN0LCBzbyBtZXRob2RzIG11c3Qgc3RpbGwgdmFsaWRhdGUuXG4gICAgY29uc3QgY29tbWFuZEFyZ3VtZW50cyA9IHRoaXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRBcmd1bWVudHMocGFyYW1zKVxuICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IGNvbW1hbmQubWV0aG9kLmNhbGwoY29tbWFuZC5yZXNvdXJjZSwgY29tbWFuZEFyZ3VtZW50cylcblxuICAgIGlmICghcmVzcG9uc2VQYXlsb2FkIHx8IHR5cGVvZiByZXNwb25zZVBheWxvYWQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChcbiAgICAgIGF3YWl0IHRoaXMuYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKFxuICAgICAgICByZXNwb25zZVBheWxvYWQsXG4gICAgICAgIC8qKiBAdHlwZSB7e3NlcmlhbGl6ZTogKG1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWN0aW9uOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19ICovIChjb21tYW5kLnJlc291cmNlKSxcbiAgICAgICAgbWV0aG9kTmFtZVxuICAgICAgKVxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgdHlwZWQgYXJndW1lbnQgb2JqZWN0IHBhc3NlZCB0byBhIGN1c3RvbSBjb21tYW5kIG1ldGhvZC4gT24gdGhlXG4gICAqIHNoYXJlZC1lbmRwb2ludCBwYXRoIHRoZSBvcmlnaW5hbCBjbGllbnQgcGF5bG9hZCB3YXMgY2FwdHVyZWQgYmVmb3JlIHJvdXRlXG4gICAqIGZyYW1ld29yayBwYXJhbXMgd2VyZSBtZXJnZWQsIHNvIGl0IGlzIHJldHVybmVkIHZlcmJhdGltIChhIGNsaWVudCBgaWRgIHN1cnZpdmVzXG4gICAqIGEgbWVtYmVyIHJvdXRlKS4gT24gdGhlIGRpcmVjdCBwYXRoIGl0IGZhbGxzIGJhY2sgdG8gdGhlIHJlcXVlc3QgcGFyYW1zIHdpdGggdGhlXG4gICAqIGZyYW1ld29yayBrZXlzIHRoZSBjb21tYW5kIHJvdXRlIGhvb2sgaW5qZWN0ZWQgc3RyaXBwZWQgb3V0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gRGVzZXJpYWxpemVkIGZyb250ZW5kLW1vZGVsIHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGllbnQgY29tbWFuZCBhcmd1bWVudHMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEFyZ3VtZW50cyhwYXJhbXMpIHtcbiAgICBpZiAodGhpcy5fZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRDbGllbnRBcmd1bWVudHMpIHtcbiAgICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZENsaWVudEFyZ3VtZW50c1xuICAgIH1cblxuICAgIGNvbnN0IHtcbiAgICAgIGFjdGlvbjogX2FjdGlvbixcbiAgICAgIGNvbnRyb2xsZXI6IF9jb250cm9sbGVyLFxuICAgICAgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRNZXRob2ROYW1lOiBfbWV0aG9kTmFtZSxcbiAgICAgIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kU2NvcGU6IF9zY29wZSxcbiAgICAgIG1vZGVsOiBfbW9kZWwsXG4gICAgICAuLi5jb21tYW5kQXJndW1lbnRzXG4gICAgfSA9IHBhcmFtc1xuXG4gICAgcmV0dXJuIGNvbW1hbmRBcmd1bWVudHNcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWxrcyBhIGN1c3RvbS1jb21tYW5kIHJlc3BvbnNlIHBheWxvYWQgYW5kIHJlcGxhY2VzIGFueSBiYWNrZW5kIGBSZWNvcmRgXG4gICAqIGluc3RhbmNlIHdpdGggdGhlIHJlc291cmNlJ3MgcGVyLWFjdGlvbiBzZXJpYWxpemVkIGZvcm0gc28gaGFuZGxlcnMgY2FuXG4gICAqIHJldHVybiBge3JlY29yZCwgc3RhdHVzOiBcIm9rXCJ9YCBpbnN0ZWFkIG9mIGV4cGxpY2l0bHkgY2FsbGluZ1xuICAgKiBgYXdhaXQgdGhpcy5zZXJpYWxpemUocmVjb3JkLCBhY3Rpb24pYC4gUGxhaW4gb2JqZWN0cywgYXJyYXlzLCBhbmRcbiAgICogcHJpbWl0aXZlIHZhbHVlcyBwYXNzIHRocm91Z2ggYW5kIGFyZSBsYXRlciBlbmNvZGVkIGJ5XG4gICAqIGBzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWVgLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFBheWxvYWQgdmFsdWUuXG4gICAqIEBwYXJhbSB7e3NlcmlhbGl6ZTogKG1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYWN0aW9uOiBzdHJpbmcpID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn19IHJlc291cmNlIC0gUmVzb3VyY2UgaW5zdGFuY2UgcHJvdmlkaW5nIGBzZXJpYWxpemVgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQ3VzdG9tIGNvbW1hbmQgbWV0aG9kIG5hbWUgcGFzc2VkIHRvIGByZXNvdXJjZS5zZXJpYWxpemVgIGZvciBwZXItYWN0aW9uIGF1dGhvcml6YXRpb24gZmlsdGVyaW5nLlxuICAgKiBAcGFyYW0ge1dlYWtTZXQ8b2JqZWN0Pn0gW3NlZW5dIC0gUmVjdXJzaW9uIHN0YWNrIG9mIHBsYWluLW9iamVjdCBjb250YWluZXJzIGN1cnJlbnRseSBiZWluZyB3YWxrZWQuIE1lbWJlcnNoaXAgaXMgYWRkZWQgb24gZW50cnkgYW5kIHJlbW92ZWQgb24gZXhpdCBzbyBhIGNvbnRhaW5lciBzaGFyZWQgYmV0d2VlbiBzaWJsaW5ncyAoaS5lLiByZWZlcmVuY2VkIHR3aWNlIGJ1dCBub3QgY3ljbGljYWxseSkgaXMgd2Fsa2VkIG9uIGVhY2ggcmVmZXJlbmNlIGluc3RlYWQgb2YgYmVpbmcgc2hvcnQtY2lyY3VpdGVkIHRoZSBzZWNvbmQgdGltZSwgd2hpY2ggd291bGQgbGV0IGJhY2tlbmQgYFJlY29yZGAgaW5zdGFuY2VzIGluc2lkZSBpdCBieXBhc3MgYHJlc291cmNlLnNlcmlhbGl6ZWAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBQYXlsb2FkIHdpdGggYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgcmVwbGFjZWQgYnkgc2VyaWFsaXplZCBtYXJrZXJzLlxuICAgKi9cbiAgYXN5bmMgYXV0b1NlcmlhbGl6ZUZyb250ZW5kTW9kZWxzSW5QYXlsb2FkKHZhbHVlLCByZXNvdXJjZSwgYWN0aW9uLCBzZWVuID0gbmV3IFdlYWtTZXQoKSkge1xuICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gdmFsdWVcbiAgICB9XG5cbiAgICBpZiAoaXNCYWNrZW5kTW9kZWxJbnN0YW5jZSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IHJpY2hTZXJpYWxpemVkID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKHZhbHVlLCBhY3Rpb24pXG4gICAgICBjb25zdCBtb2RlbE5hbWUgPSB2YWx1ZS5nZXRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgLy8gV3JhcCB0aGUgcmVzb3VyY2Utc2VyaWFsaXplZCBwYXlsb2FkIGluIHRoZSBmcm9udGVuZF9tb2RlbCB0cmFuc3BvcnRcbiAgICAgIC8vIG1hcmtlci4gTWFya2VyLWJhc2VkIGRlY29kaW5nIHJvdXRlcyB0aHJvdWdoIGBpbnN0YW50aWF0ZUZyb21SZXNwb25zZWAsXG4gICAgICAvLyBzbyBhYmlsaXRpZXMgLyBxdWVyeURhdGEgLyBhc3NvY2lhdGlvbkNvdW50cyAvIHByZWxvYWRlZFJlbGF0aW9uc2hpcHNcbiAgICAgIC8vIGJha2VkIGludG8gdGhlIHJpY2ggYXR0cmlidXRlcyBieSBgcmVzb3VyY2Uuc2VyaWFsaXplYCBhcmUgcmVzdG9yZWQgb25cbiAgICAgIC8vIHRoZSBjbGllbnQgd2l0aG91dCBjYWxsZXJzIG5lZWRpbmcgdG8gd3JhcCBtb2RlbHMgbWFudWFsbHkuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBfX3ZlbG9jaW91c190eXBlOiBcImZyb250ZW5kX21vZGVsXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHJpY2hTZXJpYWxpemVkLFxuICAgICAgICBtb2RlbE5hbWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIC8qKlxuICAgICAgICogUmVzdWx0LlxuICAgICAgICogQHR5cGUge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHJlc3VsdCA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgdmFsdWUpIHtcbiAgICAgICAgcmVzdWx0LnB1c2goYXdhaXQgdGhpcy5hdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQoZW50cnksIHJlc291cmNlLCBhY3Rpb24sIHNlZW4pKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBjb25zdCBjb250YWluZXIgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHZhbHVlKVxuXG4gICAgICBpZiAoc2Vlbi5oYXMoY29udGFpbmVyKSkge1xuICAgICAgICAvLyBDeWNsaWMgYmFjay1yZWZlcmVuY2UgYWxvbmcgdGhlIGN1cnJlbnQgcmVjdXJzaW9uIHBhdGg7IHRoZVxuICAgICAgICAvLyBhbmNlc3RvciBmcmFtZSBpcyBzdGlsbCB3YWxraW5nIHRoaXMgY29udGFpbmVyIGFuZCB3aWxsIHByb2R1Y2VcbiAgICAgICAgLy8gaXRzIHNlcmlhbGl6ZWQgZm9ybS4gUmV0dXJuaW5nIHRoZSBvcmlnaW5hbCBjb250YWluZXIgaGVyZVxuICAgICAgICAvLyBicmVha3MgdGhlIGN5Y2xlIHdpdGhvdXQgYnlwYXNzaW5nIHRoZSB3YWxrZXIgZm9yIHNpYmxpbmdzIHRoYXRcbiAgICAgICAgLy8gc2hhcmUgYSBub24tY3ljbGljIHJlZmVyZW5jZSAodGhvc2UgcmUtZW50ZXIgdGhlIGJyYW5jaCBiZWxvd1xuICAgICAgICAvLyBiZWNhdXNlIHRoZSBjb250YWluZXIgaXMgcmVtb3ZlZCBmcm9tIGBzZWVuYCBvbiBzdGFjayBleGl0KS5cbiAgICAgICAgcmV0dXJuIGNvbnRhaW5lclxuICAgICAgfVxuXG4gICAgICBzZWVuLmFkZChjb250YWluZXIpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZXN1bHQuXG4gICAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICAgICAgZm9yIChjb25zdCBba2V5LCBuZXN0ZWRdIG9mIE9iamVjdC5lbnRyaWVzKGNvbnRhaW5lcikpIHtcbiAgICAgICAgICAvLyBgYXNzaWduU2FmZVByb3BlcnR5YCBzdG9yZXMga2V5cyBsaWtlIGBfX3Byb3RvX19gIGFzIG93blxuICAgICAgICAgIC8vIGRhdGEgcHJvcGVydGllcyBpbnN0ZWFkIG9mIGludm9raW5nIHRoZSBwcm90b3R5cGUgc2V0dGVyLFxuICAgICAgICAgIC8vIHNvIGEgY3VzdG9tLWNvbW1hbmQgcmVzcG9uc2UgdGhhdCBlY2hvZXMgcGFyc2VkIGNsaWVudFxuICAgICAgICAgIC8vIGlucHV0IGNhbm5vdCBwb2xsdXRlIGBPYmplY3QucHJvdG90eXBlYCBoZXJlLiBUaGUgdHJhbnNwb3J0XG4gICAgICAgICAgLy8gc2VyaWFsaXplciBhcHBsaWVzIHRoZSBzYW1lIHByb3RlY3Rpb24gb24gaXRzIG93biBwYXNzOyB3ZVxuICAgICAgICAgIC8vIGp1c3QgcHJlc2VydmUgaXQgYWNyb3NzIHRoZSBhdXRvLXNlcmlhbGl6ZSB3YWxrLlxuICAgICAgICAgIGFzc2lnblNhZmVQcm9wZXJ0eShyZXN1bHQsIGtleSwgYXdhaXQgdGhpcy5hdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQobmVzdGVkLCByZXNvdXJjZSwgYWN0aW9uLCBzZWVuKSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHNlZW4uZGVsZXRlKGNvbnRhaW5lcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG59XG4iXX0=