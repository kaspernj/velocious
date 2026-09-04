// @ts-check
import { randomUUID } from "node:crypto";
import * as inflection from "inflection";
import Controller from "./controller.js";
import FrontendModelBaseResource, { frontendModelResourceInternalConstructor } from "./frontend-model-resource/base-resource.js";
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
 * @property {Pick<import("./frontend-model-resource/base-resource.js").default<import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass>, "applyFrontendModelIndexPagination" | "applyFrontendModelIndexSearch" | "applyFrontendModelIndexSort">} [resource] - Resource providing query hooks.
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
        const ResourceClass = frontendModelResourceInternalConstructor(frontendModelResource.resourceClass);
        return new ResourceClass(resourceArgs);
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
     * @param {{ruleQueryFactory?: () => import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>}} [options] - Authorization query options.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Authorized query for the action.
     */
    frontendModelAbilityAuthorizedQuery(action, { ruleQueryFactory } = {}) {
        const abilityAction = this.frontendModelAbilityAction(action);
        const modelClass = this.frontendModelClass();
        if (!ruleQueryFactory)
            return modelClass.accessibleFor(abilityAction, this.currentAbility());
        const ability = this.currentAbility();
        if (!ability) {
            throw new Error(`No ability in context for ${modelClass.name}. Configure an ability resolver on the request`);
        }
        return ability.applyToQuery({
            action: abilityAction,
            modelClass,
            query: modelClass._newQuery(),
            ruleQueryFactory
        });
    }
    /**
     * Runs frontend model authorized query.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @param {{ruleQueryFactory?: () => import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>}} [options] - Authorization query options.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Authorized query for the action.
     */
    frontendModelAuthorizedQuery(action, options = {}) {
        const resource = this.frontendModelResourceInstance();
        if (resource.authorizedQuery !== FrontendModelBaseResource.prototype.authorizedQuery) {
            return resource.authorizedQuery(action, options);
        }
        return this.frontendModelAbilityAuthorizedQuery(action, options);
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
        const maxCompositeCohortSize = Math.max(1, Math.floor(query.driver.maxInClauseValues() / primaryKey.length));
        const cohorts = query.driver.chunkValues(identities, (cohort) => query
            .clone()
            .where(compositeModelPrimaryKeyCohortSql({ modelClass, primaryKey, query, values: cohort }))
            .toSql(), { maxCount: maxCompositeCohortSize });
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
                    const ResourceClass = frontendModelResourceInternalConstructor(resourceClass);
                    resource = new ResourceClass({
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
        const ResourceClass = frontendModelResourceInternalConstructor(frontendModelResource.resourceClass);
        const resource = new ResourceClass({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9mcm9udGVuZC1tb2RlbC1jb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sYUFBYSxDQUFBO0FBQ3RDLE9BQU8sS0FBSyxVQUFVLE1BQU0sWUFBWSxDQUFBO0FBQ3hDLE9BQU8sVUFBVSxNQUFNLGlCQUFpQixDQUFBO0FBQ3hDLE9BQU8seUJBQXlCLEVBQUUsRUFBQyx3Q0FBd0MsRUFBQyxNQUFNLDRDQUE0QyxDQUFBO0FBQzlILE9BQU8sUUFBUSxNQUFNLGtDQUFrQyxDQUFBO0FBQ3ZELE9BQU8sRUFBQyxtREFBbUQsRUFBQyxNQUFNLHlDQUF5QyxDQUFBO0FBQzNHLE9BQU8sRUFBQyx3Q0FBd0MsRUFBRSxnREFBZ0QsRUFBRSx5QkFBeUIsRUFBRSx1Q0FBdUMsRUFBRSwyQ0FBMkMsRUFBQyxNQUFNLDBDQUEwQyxDQUFBO0FBQ3BRLE9BQU8sRUFBQywrQkFBK0IsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLHlCQUF5QixDQUFBO0FBQzNGLE9BQU8sRUFBQyxxQ0FBcUMsRUFBQyxNQUFNLDhCQUE4QixDQUFBO0FBQ2xGLE9BQU8sRUFBQyxzQkFBc0IsRUFBRSxvQkFBb0IsRUFBQyxNQUFNLDJCQUEyQixDQUFBO0FBQ3RGLE9BQU8sRUFBQyx1QkFBdUIsRUFBRSxjQUFjLElBQUksbUJBQW1CLEVBQUUsY0FBYyxJQUFJLG1CQUFtQixFQUFFLGNBQWMsSUFBSSxtQkFBbUIsRUFBRSxnQkFBZ0IsSUFBSSxxQkFBcUIsRUFBRSx1QkFBdUIsSUFBSSw0QkFBNEIsRUFBRSxhQUFhLElBQUksa0JBQWtCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUNoVSxPQUFPLEVBQUMsa0JBQWtCLEVBQUUsc0NBQXNDLEVBQUUsc0JBQXNCLEVBQUUsb0NBQW9DLEVBQUMsTUFBTSw4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O2dCQUNoRSwrREFBK0Q7Z0JBQy9ELE9BQU8sU0FBUyxDQUFBO1lBQ2xCLENBQUM7WUFFRCxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBRW5CLElBQUksQ0FBQztnQkFDSDs7MkVBRTJEO2dCQUMzRCxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7Z0JBRWpCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7b0JBQ3RELDJEQUEyRDtvQkFDM0QsNERBQTREO29CQUM1RCx5REFBeUQ7b0JBQ3pELDhEQUE4RDtvQkFDOUQsNkRBQTZEO29CQUM3RCxtREFBbUQ7b0JBQ25ELGtCQUFrQixDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsTUFBTSxJQUFJLENBQUMsb0NBQW9DLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQTtnQkFDbEgsQ0FBQztnQkFFRCxPQUFPLE1BQU0sQ0FBQTtZQUNmLENBQUM7b0JBQVMsQ0FBQztnQkFDVCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFBO1lBQ3hCLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0NBRUYiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtyYW5kb21VVUlEfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgQ29udHJvbGxlciBmcm9tIFwiLi9jb250cm9sbGVyLmpzXCJcbmltcG9ydCBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlLCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3Rvcn0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQgUmVzcG9uc2UgZnJvbSBcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0fSBmcm9tIFwiLi9mcm9udGVuZC1tb2RlbHMvYnVpbHQtaW4tcmVzb3VyY2VzLmpzXCJcbmltcG9ydCB7ZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbiwgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoLCBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QsIGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHN9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7Y3JlYXRlT2ZmbGluZUdyYW50RnJvbUJvb3RzdHJhcCwgdmVyaWZ5T2ZmbGluZUdyYW50fSBmcm9tIFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIlxuaW1wb3J0IHtzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9ufSBmcm9tIFwiLi9zeW5jL3NlcnZlci1jaGFuZ2UtZmVlZC5qc1wiXG5pbXBvcnQge211dGF0aW9uSWRlbXBvdGVuY3lLZXksIHZlcmlmeVNpZ25lZE11dGF0aW9ufSBmcm9tIFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiXG5pbXBvcnQge0Zyb250ZW5kTW9kZWxRdWVyeUVycm9yLCBub3JtYWxpemVHcm91cCBhcyBub3JtYWxpemVRdWVyeUdyb3VwLCBub3JtYWxpemVKb2lucyBhcyBub3JtYWxpemVRdWVyeUpvaW5zLCBub3JtYWxpemVQbHVjayBhcyBub3JtYWxpemVRdWVyeVBsdWNrLCBub3JtYWxpemVQcmVsb2FkIGFzIG5vcm1hbGl6ZVF1ZXJ5UHJlbG9hZCwgbm9ybWFsaXplU2VhcmNoT3BlcmF0b3IgYXMgbm9ybWFsaXplUXVlcnlTZWFyY2hPcGVyYXRvciwgbm9ybWFsaXplU29ydCBhcyBub3JtYWxpemVRdWVyeVNvcnR9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9xdWVyeS5qc1wiXG5pbXBvcnQge2Fzc2lnblNhZmVQcm9wZXJ0eSwgZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUsIGlzQmFja2VuZE1vZGVsSW5zdGFuY2UsIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZX0gZnJvbSBcIi4vZnJvbnRlbmQtbW9kZWxzL3RyYW5zcG9ydC1zZXJpYWxpemF0aW9uLmpzXCJcbmltcG9ydCB7cmVxdWVzdERldGFpbHN9IGZyb20gXCIuL2Vycm9yLXJlcG9ydGluZy9yZXF1ZXN0LWRldGFpbHMuanNcIlxuaW1wb3J0IFJvdXRlc1Jlc29sdmVyIGZyb20gXCIuL3JvdXRlcy9yZXNvbHZlci5qc1wiXG5pbXBvcnQge1ZhbGlkYXRpb25FcnJvcn0gZnJvbSBcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCBSZWNvcmROb3RGb3VuZEVycm9yIGZyb20gXCIuL2RhdGFiYXNlL3JlY29yZC9yZWNvcmQtbm90LWZvdW5kLWVycm9yLmpzXCJcbmltcG9ydCB7Y2FwdHVyZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dCwgbWVyZ2VGcm9udGVuZE1vZGVsUmVtb3RlUmVxdWVzdENvbnRleHR9IGZyb20gXCIuL2Zyb250ZW5kLW1vZGVscy9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCJcbmltcG9ydCB7IG5vcm1hbGl6ZURhdGVTdHJpbmdGb3JXcml0ZSB9IGZyb20gXCIuL2RhdGFiYXNlL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQgaXNEYXRlIGZyb20gXCIuL3V0aWxzL2lzLWRhdGUuanNcIlxuaW1wb3J0IGlzUGxhaW5PYmplY3QgZnJvbSBcIi4vdXRpbHMvcGxhaW4tb2JqZWN0LmpzXCJcbmltcG9ydCB7Y29tcG9zaXRlTW9kZWxQcmltYXJ5S2V5Q29ob3J0U3FsLCBtb2RlbFByaW1hcnlLZXlDYWNoZUtleSwgbW9kZWxQcmltYXJ5S2V5Q29uZGl0aW9ucywgbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXksIHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5fSBmcm9tIFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge1JhbnNhY2tRdWVyeUVycm9yLCBub3JtYWxpemVSYW5zYWNrR3JvdXAsIHBhcnNlUmFuc2Fja1NvcnR9IGZyb20gXCIuL3V0aWxzL3JhbnNhY2suanNcIlxuXG4vKipcbiAqIEZyb250ZW5kTW9kZWxTZWFyY2ggdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxTZWFyY2hcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW119IHBhdGggLSBSZWxhdGlvbnNoaXAgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBDb2x1bW4gb3IgYXR0cmlidXRlIG5hbWUuXG4gKiBAcHJvcGVydHkge1wiZXFcIiB8IFwibGlrZVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIn0gb3BlcmF0b3IgLSBTZWFyY2ggb3BlcmF0b3IuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFNlYXJjaCB2YWx1ZS5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsU29ydCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFNvcnRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2x1bW4gLSBBdHRyaWJ1dGUgbmFtZSB0byBzb3J0IGJ5LlxuICogQHByb3BlcnR5IHtcImFzY1wiIHwgXCJkZXNjXCJ9IGRpcmVjdGlvbiAtIFNvcnQgZGlyZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsR3JvdXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxHcm91cFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIGdyb3VwIGJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUGx1Y2sgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZyb250ZW5kTW9kZWxQbHVja1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGNvbHVtbiAtIEF0dHJpYnV0ZSBuYW1lIHRvIHBsdWNrLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdCBtb2RlbC5cbiAqL1xuLyoqXG4gKiBGcm9udGVuZE1vZGVsUGFnaW5hdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbFBhZ2luYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gbGltaXQgLSBNYXhpbXVtIG51bWJlciBvZiByZWNvcmRzLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBvZmZzZXQgLSBOdW1iZXIgb2YgcmVjb3JkcyB0byBza2lwLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBwYWdlIC0gMS1iYXNlZCBwYWdlIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyIHwgbnVsbH0gcGVyUGFnZSAtIFBhZ2Ugc2l6ZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZENvbnRleHQgJiB7XG4gKiAgIGFjdGlvbjogc3RyaW5nLFxuICogICBleHBlY3RlZEVycm9yOiBib29sZWFuLFxuICogICBmcm9udGVuZE1vZGVsRW5kcG9pbnQ6IHRydWVcbiAqIH19IEZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dFxuICovXG4vKipcbiAqIEZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5T3B0aW9ucyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRnJvbnRlbmRNb2RlbEluZGV4UXVlcnlPcHRpb25zXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtpbmNsdWRlUGFnaW5hdGlvbl0gLSBXaGV0aGVyIGZyb250ZW5kLW1vZGVsIHBhZ2luYXRpb24gcGFyYW1zIHNob3VsZCBiZSBhcHBsaWVkLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbaW5jbHVkZVNvcnRdIC0gV2hldGhlciBmcm9udGVuZC1tb2RlbCBzb3J0IHBhcmFtcyBzaG91bGQgYmUgYXBwbGllZC5cbiAqIEBwcm9wZXJ0eSB7UGljazxpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdDxpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcz4sIFwiYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoXCIgfCBcImFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydFwiPn0gW3Jlc291cmNlXSAtIFJlc291cmNlIHByb3ZpZGluZyBxdWVyeSBob29rcy5cbiAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQgJiBSZWNvcmQ8c3ltYm9sLCBTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZD59IEZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhICovXG4vKipcbiAqIEBjYWxsYmFjayBGcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UgYmVpbmcgc2VyaWFsaXplZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSByZXNvdXJjZSAtIFJlc29sdmVkIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UsIGlmIGFueS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5cbmNvbnN0IEFUVEFDSE1FTlRfT1dORVJfS0VZID0gXCJfX2F0dGFjaG1lbnRPd25lclwiXG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgcHJlbG9hZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgc3RyaW5nW10gfCBib29sZWFuIHwgdW5kZWZpbmVkIHwgbnVsbH0gcHJlbG9hZCAtIFByZWxvYWQgc2hvcnRoYW5kLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGx9IC0gTm9ybWFsaXplZCBwcmVsb2FkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUHJlbG9hZChwcmVsb2FkKSB7XG4gIGlmICghcHJlbG9hZCkgcmV0dXJuIG51bGxcblxuICB0cnkge1xuICAgIHJldHVybiBub3JtYWxpemVRdWVyeVByZWxvYWQocHJlbG9hZClcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgam9pbnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBqb2lucyAtIEpvaW5zIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gLSBOb3JtYWxpemVkIHJlbGF0aW9uc2hpcC1vYmplY3Qgam9pbnMuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxKb2lucyhqb2lucykge1xuICBpZiAoIWpvaW5zKSByZXR1cm4gbnVsbFxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVF1ZXJ5Sm9pbnMoam9pbnMpXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIGZyb250ZW5kIG1vZGVsIHNlbGVjdC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHNlbGVjdCAtIFNlbGVjdCBwYXlsb2FkLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudWxsfSBbcm9vdE1vZGVsTmFtZV0gLSBPcHRpb25hbCByb290IG1vZGVsIG5hbWUgZm9yIHNob3J0aGFuZCBwYXlsb2Fkcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gfCBudWxsfSAtIE5vcm1hbGl6ZWQgbW9kZWwtbmFtZSBrZXllZCBzZWxlY3QgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsU2VsZWN0KHNlbGVjdCwgcm9vdE1vZGVsTmFtZSA9IG51bGwpIHtcbiAgaWYgKCFzZWxlY3QpIHJldHVybiBudWxsXG5cbiAgaWYgKHR5cGVvZiBzZWxlY3QgPT09IFwic3RyaW5nXCIpIHtcbiAgICBpZiAoIXJvb3RNb2RlbE5hbWUpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwiSW52YWxpZCBzZWxlY3Qgc2hvcnRoYW5kIHdpdGhvdXQgcm9vdCBtb2RlbCBuYW1lXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtbcm9vdE1vZGVsTmFtZV06IFtzZWxlY3RdfVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoc2VsZWN0KSkge1xuICAgIGlmICghcm9vdE1vZGVsTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlbGVjdCBzaG9ydGhhbmQgd2l0aG91dCByb290IG1vZGVsIG5hbWVcIilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2Ygc2VsZWN0KSB7XG4gICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU5hbWUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VsZWN0IGF0dHJpYnV0ZSBmb3IgJHtyb290TW9kZWxOYW1lfTogJHt0eXBlb2YgYXR0cmlidXRlTmFtZX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7W3Jvb3RNb2RlbE5hbWVdOiBBcnJheS5mcm9tKG5ldyBTZXQoc2VsZWN0KSl9XG4gIH1cblxuICBpZiAoIWlzUGxhaW5PYmplY3Qoc2VsZWN0KSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlbGVjdCB0eXBlOiAke3R5cGVvZiBzZWxlY3R9YClcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVkLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+fSAqL1xuICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICBmb3IgKGNvbnN0IFttb2RlbE5hbWUsIHNlbGVjdFZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzZWxlY3QpKSB7XG4gICAgaWYgKHR5cGVvZiBzZWxlY3RWYWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgbm9ybWFsaXplZFttb2RlbE5hbWVdID0gW3NlbGVjdFZhbHVlXVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoc2VsZWN0VmFsdWUpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWxlY3QgdmFsdWUgZm9yICR7bW9kZWxOYW1lfTogJHt0eXBlb2Ygc2VsZWN0VmFsdWV9YClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2Ygc2VsZWN0VmFsdWUpIHtcbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCBzZWxlY3QgYXR0cmlidXRlIGZvciAke21vZGVsTmFtZX06ICR7dHlwZW9mIGF0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBub3JtYWxpemVkW21vZGVsTmFtZV0gPSBBcnJheS5mcm9tKG5ldyBTZXQoc2VsZWN0VmFsdWUpKVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuY29uc3QgZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sID0gU3ltYm9sKFwiZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzXCIpXG5jb25zdCBmcm9udGVuZE1vZGVsR3JvdXBlZENvbHVtbnNTeW1ib2wgPSBTeW1ib2woXCJmcm9udGVuZE1vZGVsR3JvdXBlZENvbHVtbnNcIilcbmNvbnN0IGZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hTeW1ib2wgPSBTeW1ib2woXCJmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoXCIpXG5jb25zdCBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSA9IFwiUmVxdWVzdCBmYWlsZWQuXCJcblxuLyoqXG4gKiBCdWlsZHMgYSBjbGllbnQtc2FmZSBzeW5jIHJlcGxheSB2YWxpZGF0aW9uIGVycm9yLlxuICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBDbGllbnQtc2FmZSB2YWxpZGF0aW9uIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge3Vua25vd259IFtjYXVzZV0gLSBPcmlnaW5hbCBjYXVzZS5cbiAqIEByZXR1cm5zIHtWZWxvY2lvdXNFcnJvcn0gLSBDbGllbnQtc2FmZSByZXBsYXkgZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihtZXNzYWdlLCBjYXVzZSkge1xuICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShtZXNzYWdlLCB7XG4gICAgY2F1c2UsXG4gICAgY29kZTogXCJmcm9udGVuZF9zeW5jX3JlcGxheV9lcnJvclwiXG4gIH0pXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBxdWVyeSBtZXRhZGF0YS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBxdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhfSAtIFF1ZXJ5IG1ldGFkYXRhIGFjY2VzcyBoZWxwZXIuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KSB7XG4gIHJldHVybiAvKiogQHR5cGUge0Zyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhfSAqLyAocXVlcnkpXG59XG5cbi8qKlxuICogQnVpbGRzIGEgY2xpZW50LXNhZmUgZnJvbnRlbmQtbW9kZWwgcXVlcnkgZXJyb3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIEVycm9yIG1lc3NhZ2UuXG4gKiBAcmV0dXJucyB7VmVsb2Npb3VzRXJyb3J9IENsaWVudC1zYWZlIHF1ZXJ5IGVycm9yLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihtZXNzYWdlKSB7XG4gIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKG1lc3NhZ2UsIHtjb2RlOiBcImZyb250ZW5kLW1vZGVsLXF1ZXJ5LWVycm9yXCJ9KVxufVxuXG4vKipcbiAqIFRocm93cyBhIGNsaWVudC1zYWZlIGZyb250ZW5kLW1vZGVsIHF1ZXJ5IGVycm9yIGZvciB0eXBlZCBxdWVyeSBwYXJzZXIgZXJyb3JzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBFcnJvciByYWlzZWQgd2hpbGUgbm9ybWFsaXppbmcgY2xpZW50IHF1ZXJ5IHBhcmFtcy5cbiAqIEByZXR1cm5zIHtuZXZlcn0gQWx3YXlzIHRocm93cy5cbiAqL1xuZnVuY3Rpb24gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKSB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEZyb250ZW5kTW9kZWxRdWVyeUVycm9yIHx8IGVycm9yIGluc3RhbmNlb2YgUmFuc2Fja1F1ZXJ5RXJyb3IpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihlcnJvci5tZXNzYWdlKVxuICB9XG5cbiAgdGhyb3cgZXJyb3Jcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBlcnJvciBjYXJyaWVzIGFuIGBlcnJvci52ZWxvY2lvdXNgIG1ldGFkYXRhIGJhZy4gVGhlXG4gKiBwcmVzZW5jZSBvZiBhbnkgc3VjaCBiYWcgbWFya3MgdGhlIGVycm9yIGFzIFwiYW5ub3RhdGVkIGJ5IHRoZVxuICogZGV2ZWxvcGVyIGZvciB0aGUgZnJvbnRlbmRcIiDigJQgdGhlIGZyYW1ld29yayB0cmVhdHMgaXQgYXNcbiAqIHVzZXItZmFjaW5nOiBzdXJmYWNlIHRoZSBtZXNzYWdlLCBmb3J3YXJkIHRoZSBtZXRhZGF0YSwgYW5kIHNraXBcbiAqIHRoZSBub2lzeSBlbmRwb2ludC1lcnJvciBsb2cuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIGVycm9yIGhhcyBWZWxvY2lvdXMgZnJvbnRlbmQgbWV0YWRhdGEuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFcnJvckhhc1ZlbG9jaW91c01ldGFkYXRhKGVycm9yKSB7XG4gIGlmICghZXJyb3IgfHwgdHlwZW9mIGVycm9yICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2VcblxuICAvLyBSdW50aW1lIGNoZWNrcyBhYm92ZSBuYXJyb3cgdGhpcyBjYXVnaHQgdmFsdWUgdG8gdGhlIG1ldGFkYXRhIHJlY29yZCBzaGFwZS5cbiAgY29uc3QgZXJyb3JSZWNvcmQgPSAvKiogQHR5cGUge3t2ZWxvY2lvdXM/OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkfX0gKi8gKGVycm9yKVxuXG4gIHJldHVybiBpc1BsYWluT2JqZWN0KGVycm9yUmVjb3JkLnZlbG9jaW91cylcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBlcnJvciBpcyBhbiBleHBlY3RlZCBmcm9udGVuZC1tb2RlbCB1c2VyLWZsb3cgZmFpbHVyZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgZXJyb3IgaXMgZXhwZWN0ZWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxFeHBlY3RlZEVycm9yKGVycm9yKSB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFJlY29yZE5vdEZvdW5kRXJyb3IpIHJldHVybiB0cnVlXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikgcmV0dXJuIHRydWVcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSByZXR1cm4gdHJ1ZVxuICBpZiAoZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEoZXJyb3IpKSByZXR1cm4gdHJ1ZVxuXG4gIHJldHVybiBmYWxzZVxufVxuXG4vKipcbiAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgdmVsb2Npb3VzIG1ldGFkYXRhIGZvciBlcnJvci5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZCB8IG51bGx9IEZyb250ZW5kLW1vZGVsIFZlbG9jaW91cyBtZXRhZGF0YSB3aGVuIHByZXNlbnQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxWZWxvY2lvdXNNZXRhZGF0YUZvckVycm9yKGVycm9yKSB7XG4gIGNvbnN0IGVycm9yQ29kZSA9IGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlICYmIHR5cGVvZiBlcnJvci5jb2RlID09PSBcInN0cmluZ1wiICYmIGVycm9yLmNvZGUubGVuZ3RoID4gMFxuICAgID8gZXJyb3IuY29kZVxuICAgIDogbnVsbFxuXG4gIGlmICghZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEoZXJyb3IpKSB7XG4gICAgcmV0dXJuIGVycm9yQ29kZSA/IHtjb2RlOiBlcnJvckNvZGV9IDogbnVsbFxuICB9XG5cbiAgLy8gZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEgZ3VhcmRzIHRoZSBjYXVnaHQgdmFsdWUgYmVmb3JlIHRoaXMgY2FzdC5cbiAgY29uc3QgZXJyb3JSZWNvcmQgPSAvKiogQHR5cGUge3t2ZWxvY2lvdXM6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9fSAqLyAoZXJyb3IpXG4gIGNvbnN0IG1ldGFkYXRhID0gZXJyb3JSZWNvcmQudmVsb2Npb3VzXG5cbiAgcmV0dXJuIGVycm9yQ29kZSA/IHsuLi5tZXRhZGF0YSwgY29kZTogZXJyb3JDb2RlfSA6IG1ldGFkYXRhXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBjbGllbnQgbWVzc2FnZSBmb3IgZXJyb3IuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICogQHBhcmFtIHtib29sZWFufSBleHBvc2VJbnRlcm5hbEVycm9yc1RvQ2xpZW50cyAtIFdoZXRoZXIgdW5leHBlY3RlZCBlcnJvciBtZXNzYWdlcyBtYXkgYmUgZXhwb3NlZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTWVzc2FnZSBzYWZlIHRvIHJldHVybiB0byBBUEkgY2xpZW50cy5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbENsaWVudE1lc3NhZ2VGb3JFcnJvcihlcnJvciwgZXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMpIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmVjb3JkTm90Rm91bmRFcnJvcikge1xuICAgIHJldHVybiBcIlJlY29yZCBub3QgZm91bmQuXCJcbiAgfVxuXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkge1xuICAgIHJldHVybiBlcnJvci5tZXNzYWdlXG4gIH1cblxuICAvLyBWYWxpZGF0aW9uIGZhaWx1cmVzIGFyZSBleHBlY3RlZCB1c2VyLWZsb3cgZXJyb3JzLiBBbHdheXMgZm9yd2FyZCB0aGVcbiAgLy8gdmFsaWRhdGlvbiBzdW1tYXJ5IHNvIHRoZSBjbGllbnQgc2hvd3MgdGhlIHJlYWwgcmVhc29uIChlLmcuIFwiTmFtZSBjYW4ndFxuICAvLyBiZSBibGFua1wiKSBpbnN0ZWFkIG9mIHRoZSBnZW5lcmljIFwiUmVxdWVzdCBmYWlsZWQuXCIgbWVzc2FnZSwgcmVnYXJkbGVzcyBvZlxuICAvLyB3aGV0aGVyIHRoZSByYWlzaW5nIGNvZGUgYWxzbyBhdHRhY2hlZCBlcnJvci52ZWxvY2lvdXMgbWV0YWRhdGEuXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikge1xuICAgIHJldHVybiBlcnJvci5tZXNzYWdlXG4gIH1cblxuICBpZiAoZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEoZXJyb3IpICYmIGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICByZXR1cm4gZXJyb3IubWVzc2FnZVxuICB9XG5cbiAgaWYgKGV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzICYmIGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiBlcnJvci5tZXNzYWdlXG5cbiAgcmV0dXJuIGZyb250ZW5kTW9kZWxDbGllbnRTYWZlRXJyb3JNZXNzYWdlXG59XG5cbi8qKlxuICogUnVucyBmcm9udGVuZCBtb2RlbCBkZWJ1ZyBwYXlsb2FkIGZvciBlcnJvci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ3VycmVudCBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLmVycm9yIC0gQ2F1Z2h0IGVycm9yLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9IC0gT3B0aW9uYWwgaW50ZXJuYWwgZXJyb3IgZGV0YWlscyB3aGVuIGNsaWVudCBleHBvc3VyZSBpcyBlbmFibGVkLlxuICovXG5mdW5jdGlvbiBmcm9udGVuZE1vZGVsRGVidWdQYXlsb2FkRm9yRXJyb3Ioe2NvbmZpZ3VyYXRpb24sIGVycm9yfSkge1xuICBpZiAoIWNvbmZpZ3VyYXRpb24uZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKSkge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZWNvcmROb3RGb3VuZEVycm9yKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBpZiAoZnJvbnRlbmRNb2RlbEVycm9ySGFzVmVsb2Npb3VzTWV0YWRhdGEoZXJyb3IpKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICBjb25zdCBkZWJ1Z0Vycm9yQ2xhc3MgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLm5hbWVcbiAgICA/IGVycm9yLm5hbWVcbiAgICA6IHR5cGVvZiBlcnJvclxuICBjb25zdCBkZWJ1Z0Vycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3JcbiAgICA/IGVycm9yLm1lc3NhZ2VcbiAgICA6IFN0cmluZyhlcnJvcilcbiAgY29uc3QgZGVidWdCYWNrdHJhY2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIHR5cGVvZiBlcnJvci5zdGFjayA9PT0gXCJzdHJpbmdcIiAmJiBlcnJvci5zdGFjay5sZW5ndGggPiAwXG4gICAgPyBlcnJvci5zdGFjay5zcGxpdChcIlxcblwiKVxuICAgIDogdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHtcbiAgICBkZWJ1Z0Vycm9yQ2xhc3MsXG4gICAgZGVidWdFcnJvck1lc3NhZ2UsXG4gICAgLi4uKGRlYnVnQmFja3RyYWNlID8ge2RlYnVnQmFja3RyYWNlfSA6IHt9KVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgc2VhcmNoZXMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzZWFyY2hlcyAtIFNlYXJjaCBwYXlsb2FkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gLSBOb3JtYWxpemVkIHNlYXJjaGVzLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsU2VhcmNoZXMoc2VhcmNoZXMpIHtcbiAgaWYgKCFzZWFyY2hlcykgcmV0dXJuIFtdXG5cbiAgaWYgKCFBcnJheS5pc0FycmF5KHNlYXJjaGVzKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHNlYXJjaGVzIHR5cGU6ICR7dHlwZW9mIHNlYXJjaGVzfWApXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplZC5cbiAgICogQHR5cGUge0Zyb250ZW5kTW9kZWxTZWFyY2hbXX0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IFtdXG5cbiAgZm9yIChjb25zdCBzZWFyY2ggb2Ygc2VhcmNoZXMpIHtcbiAgICBpZiAoIWlzUGxhaW5PYmplY3Qoc2VhcmNoKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VhcmNoIGVudHJ5IHR5cGU6ICR7dHlwZW9mIHNlYXJjaH1gKVxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSBzZWFyY2gucGF0aFxuICAgIGNvbnN0IGNvbHVtbiA9IHNlYXJjaC5jb2x1bW5cbiAgICBjb25zdCBvcGVyYXRvciA9IHNlYXJjaC5vcGVyYXRvclxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHBhdGgpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihcIkludmFsaWQgc2VhcmNoIHBhdGg6IGV4cGVjdGVkIGFuIGFycmF5XCIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBwYXRoRW50cnkgb2YgcGF0aCkge1xuICAgICAgaWYgKHR5cGVvZiBwYXRoRW50cnkgIT09IFwic3RyaW5nXCIgfHwgcGF0aEVudHJ5Lmxlbmd0aCA8IDEpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoXCJJbnZhbGlkIHNlYXJjaCBwYXRoIGVudHJ5OiBleHBlY3RlZCBub24tZW1wdHkgc3RyaW5nXCIpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb2x1bW4gIT09IFwic3RyaW5nXCIgfHwgY29sdW1uLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKFwiSW52YWxpZCBzZWFyY2ggY29sdW1uOiBleHBlY3RlZCBub24tZW1wdHkgc3RyaW5nXCIpXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBvcGVyYXRvciAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYEludmFsaWQgc2VhcmNoIG9wZXJhdG9yOiAke29wZXJhdG9yfWApXG4gICAgfVxuXG4gICAgbGV0IG5vcm1hbGl6ZWRPcGVyYXRvclxuXG4gICAgdHJ5IHtcbiAgICAgIG5vcm1hbGl6ZWRPcGVyYXRvciA9IG5vcm1hbGl6ZVF1ZXJ5U2VhcmNoT3BlcmF0b3Iob3BlcmF0b3IpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93RnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3JGb3JQYXJzZXJFcnJvcihlcnJvcilcbiAgICB9XG5cbiAgICBub3JtYWxpemVkLnB1c2goe1xuICAgICAgY29sdW1uLFxuICAgICAgb3BlcmF0b3I6IG5vcm1hbGl6ZWRPcGVyYXRvcixcbiAgICAgIHBhdGg6IFsuLi5wYXRoXSxcbiAgICAgIHZhbHVlOiBzZWFyY2gudmFsdWVcbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCB3aGVyZS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHdoZXJlIC0gV2hlcmUgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIE5vcm1hbGl6ZWQgd2hlcmUgaGFzaC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlKHdoZXJlKSB7XG4gIGlmICghd2hlcmUpIHJldHVybiBudWxsXG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHdoZXJlKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIHdoZXJlIHR5cGU6ICR7dHlwZW9mIHdoZXJlfWApXG4gIH1cblxuICByZXR1cm4gd2hlcmVcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCByYW5zYWNrLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmFuc2FjayAtIFJhbnNhY2sgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSAtIE5vcm1hbGl6ZWQgUmFuc2FjayBoYXNoLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUmFuc2FjayhyYW5zYWNrKSB7XG4gIGlmICghcmFuc2FjaykgcmV0dXJuIG51bGxcblxuICBpZiAoIWlzUGxhaW5PYmplY3QocmFuc2FjaykpIHtcbiAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgSW52YWxpZCByYW5zYWNrIHR5cGU6ICR7dHlwZW9mIHJhbnNhY2t9YClcbiAgfVxuXG4gIHJldHVybiByYW5zYWNrXG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgaW50ZWdlciBwYXJhbS5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIGludGVnZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFBhcmFtIG5hbWUgZm9yIGVycm9ycy5cbiAqIEBwYXJhbSB7bnVtYmVyfSBtaW4gLSBNaW5pbXVtIGFsbG93ZWQgdmFsdWUuXG4gKiBAcmV0dXJucyB7bnVtYmVyIHwgbnVsbH0gLSBOb3JtYWxpemVkIGludGVnZXIuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0odmFsdWUsIG5hbWUsIG1pbikge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSkge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkICR7bmFtZX06IGV4cGVjdGVkIGludGVnZXIgbnVtYmVyYClcbiAgfVxuXG4gIGlmICh2YWx1ZSA8IG1pbikge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkICR7bmFtZX06IGV4cGVjdGVkIHZhbHVlID49ICR7bWlufWApXG4gIH1cblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCBwYWdpbmF0aW9uLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYWdpbmF0aW9uIGFyZ3MuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmxpbWl0IC0gTGltaXQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Mub2Zmc2V0IC0gT2Zmc2V0IHBheWxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBhZ2UgLSBQYWdlIHBheWxvYWQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBlclBhZ2UgLSBQZXItcGFnZSBwYXlsb2FkLlxuICogQHJldHVybnMge0Zyb250ZW5kTW9kZWxQYWdpbmF0aW9ufSAtIE5vcm1hbGl6ZWQgcGFnaW5hdGlvbiBkYXRhLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVGcm9udGVuZE1vZGVsUGFnaW5hdGlvbih7bGltaXQsIG9mZnNldCwgcGFnZSwgcGVyUGFnZX0pIHtcbiAgcmV0dXJuIHtcbiAgICBsaW1pdDogbm9ybWFsaXplRnJvbnRlbmRNb2RlbEludGVnZXJQYXJhbShsaW1pdCwgXCJsaW1pdFwiLCAwKSxcbiAgICBvZmZzZXQ6IG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxJbnRlZ2VyUGFyYW0ob2Zmc2V0LCBcIm9mZnNldFwiLCAwKSxcbiAgICBwYWdlOiBub3JtYWxpemVGcm9udGVuZE1vZGVsSW50ZWdlclBhcmFtKHBhZ2UsIFwicGFnZVwiLCAxKSxcbiAgICBwZXJQYWdlOiBub3JtYWxpemVGcm9udGVuZE1vZGVsSW50ZWdlclBhcmFtKHBlclBhZ2UsIFwicGVyUGFnZVwiLCAxKVxuICB9XG59XG5cbi8qKlxuICogUnVucyBub3JtYWxpemUgZnJvbnRlbmQgbW9kZWwgZGlzdGluY3QuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBkaXN0aW5jdCAtIERpc3RpbmN0IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbiB8IG51bGx9IC0gTm9ybWFsaXplZCBkaXN0aW5jdCBmbGFnIHdoZW4gcHJvdmlkZWQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxEaXN0aW5jdChkaXN0aW5jdCkge1xuICBpZiAoZGlzdGluY3QgPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICBpZiAodHlwZW9mIGRpc3RpbmN0ICE9PSBcImJvb2xlYW5cIikge1xuICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBJbnZhbGlkIGRpc3RpbmN0OiBleHBlY3RlZCBib29sZWFuYClcbiAgfVxuXG4gIHJldHVybiBkaXN0aW5jdFxufVxuXG4vKipcbiAqIFJ1bnMgYnVpbGQgZnJvbnRlbmQgbW9kZWwgam9pbiBvYmplY3QgZnJvbSBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBKb2luIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGcm9udGVuZE1vZGVsSm9pbk9iamVjdEZyb21QYXRoKHBhdGgpIHtcbiAgLyoqXG4gICAqIEpvaW4gb2JqZWN0LlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBjb25zdCBqb2luT2JqZWN0ID0ge31cbiAgLyoqXG4gICAqIEN1cnJlbnQgbm9kZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgbGV0IGN1cnJlbnROb2RlID0gam9pbk9iamVjdFxuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgY3VycmVudE5vZGVbcmVsYXRpb25zaGlwTmFtZV0gPSB7fVxuICAgIGN1cnJlbnROb2RlID0gY3VycmVudE5vZGVbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIHJldHVybiBqb2luT2JqZWN0XG59XG5cbi8qKlxuICogQnVpbGQgYSBzdWNjZXNzZnVsIHNpbmdsZS1tb2RlbCBmcm9udGVuZC1tb2RlbCByZXNwb25zZSBwYXlsb2FkLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IG1vZGVsIC0gU2VyaWFsaXplZCBtb2RlbCBwYXlsb2FkLlxuICogQHJldHVybnMge3ttb2RlbDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzdGF0dXM6IFwic3VjY2Vzc1wifX0gLSBTdWNjZXNzIHJlc3BvbnNlIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKG1vZGVsKSB7XG4gIHJldHVybiB7bW9kZWwsIHN0YXR1czogXCJzdWNjZXNzXCJ9XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhbmQgdmFsaWRhdGUgYXR0YWNobWVudCBwYXJhbXMgc2hhcmVkIGJ5IGF0dGFjaG1lbnQgY29tbWFuZHMuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gRnJvbnRlbmQtbW9kZWwgcmVxdWVzdCBwYXJhbXMuXG4gKiBAcmV0dXJucyB7e2F0dGFjaG1lbnRJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBhdHRhY2htZW50TmFtZTogc3RyaW5nfSB8IHN0cmluZ30gLSBBdHRhY2htZW50IHBhcmFtcyBvciB2YWxpZGF0aW9uIGVycm9yIG1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGZyb250ZW5kTW9kZWxBdHRhY2htZW50UGFyYW1zKHBhcmFtcykge1xuICBjb25zdCBhdHRhY2htZW50TmFtZSA9IHBhcmFtcy5hdHRhY2htZW50TmFtZVxuXG4gIGlmICh0eXBlb2YgYXR0YWNobWVudE5hbWUgIT09IFwic3RyaW5nXCIgfHwgYXR0YWNobWVudE5hbWUubGVuZ3RoIDwgMSkge1xuICAgIHJldHVybiBcIkV4cGVjdGVkIGF0dGFjaG1lbnROYW1lLlwiXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGF0dGFjaG1lbnRJZDogdHlwZW9mIHBhcmFtcy5hdHRhY2htZW50SWQgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMuYXR0YWNobWVudElkIDogdW5kZWZpbmVkLFxuICAgIGF0dGFjaG1lbnROYW1lXG4gIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0IG11dGF0aW9uIGF0dHJpYnV0ZXMgc2hhcmVkIGJ5IGNyZWF0ZSBhbmQgdXBkYXRlIGNvbW1hbmRzLlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIEZyb250ZW5kLW1vZGVsIHJlcXVlc3QgcGFyYW1zLlxuICogQHJldHVybnMge3thdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGF0dGFjaG1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsLCBuZXN0ZWRBdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSB8IHN0cmluZ30gLSBNdXRhdGlvbiBhdHRyaWJ1dGVzIG9yIHZhbGlkYXRpb24gZXJyb3IgbWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gZnJvbnRlbmRNb2RlbE11dGF0aW9uQXR0cmlidXRlcyhwYXJhbXMpIHtcbiAgY29uc3QgYXR0cmlidXRlcyA9IHBhcmFtcy5hdHRyaWJ1dGVzXG5cbiAgaWYgKCFpc1BsYWluT2JqZWN0KGF0dHJpYnV0ZXMpKSB7XG4gICAgcmV0dXJuIFwiRXhwZWN0ZWQgbW9kZWwgYXR0cmlidXRlcy5cIlxuICB9XG5cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IHJlZ3VsYXJBdHRyaWJ1dGVzID0ge31cbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIGNvbnN0IG5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgIGlmIChhdHRyaWJ1dGVOYW1lLmVuZHNXaXRoKFwiQXR0cmlidXRlc1wiKSkge1xuICAgICAgY29uc3QgcmVsYXRpb25zaGlwTmFtZSA9IGF0dHJpYnV0ZU5hbWUuc2xpY2UoMCwgLVwiQXR0cmlidXRlc1wiLmxlbmd0aClcblxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lKSByZXR1cm4gYEludmFsaWQgbmVzdGVkIGF0dHJpYnV0ZXMga2V5OiAke2F0dHJpYnV0ZU5hbWV9YFxuICAgICAgbmVzdGVkQXR0cmlidXRlc1tyZWxhdGlvbnNoaXBOYW1lXSA9IHZhbHVlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlZ3VsYXJBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG4gIH1cblxuICBpZiAocGFyYW1zLm5lc3RlZEF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmICghaXNQbGFpbk9iamVjdChwYXJhbXMubmVzdGVkQXR0cmlidXRlcykpIHJldHVybiBcIkV4cGVjdGVkIG5lc3RlZEF0dHJpYnV0ZXMgdG8gYmUgYW4gb2JqZWN0LlwiXG5cbiAgICBPYmplY3QuYXNzaWduKG5lc3RlZEF0dHJpYnV0ZXMsIHBhcmFtcy5uZXN0ZWRBdHRyaWJ1dGVzKVxuICB9XG5cbiAgaWYgKHBhcmFtcy5hdHRhY2htZW50cyAhPT0gdW5kZWZpbmVkICYmICFpc1BsYWluT2JqZWN0KHBhcmFtcy5hdHRhY2htZW50cykpIHtcbiAgICByZXR1cm4gXCJFeHBlY3RlZCBhdHRhY2htZW50cyB0byBiZSBhbiBvYmplY3QuXCJcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYXR0cmlidXRlczogcmVndWxhckF0dHJpYnV0ZXMsXG4gICAgYXR0YWNobWVudHM6IHBhcmFtcy5hdHRhY2htZW50cyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHBhcmFtcy5hdHRhY2htZW50cyxcbiAgICBuZXN0ZWRBdHRyaWJ1dGVzOiBPYmplY3Qua2V5cyhuZXN0ZWRBdHRyaWJ1dGVzKS5sZW5ndGggPiAwID8gbmVzdGVkQXR0cmlidXRlcyA6IG51bGxcbiAgfVxufVxuXG4vKiogQ29udHJvbGxlciB3aXRoIGJ1aWx0LWluIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGFjdGlvbnMuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBGcm9udGVuZE1vZGVsQ29udHJvbGxlciBleHRlbmRzIENvbnRyb2xsZXIge1xuICAvKipcbiAgICogRnJvbnRlbmQgbW9kZWwgcGFyYW1zLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbFBhcmFtcyA9IHVuZGVmaW5lZFxuICAvKipcbiAgICogRnJvbnRlbmQgbW9kZWwgcGFyYW1zIG92ZXJyaWRlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqL1xuICBfZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBGcm9udGVuZCBtb2RlbCBhYmlsaXR5IG92ZXJyaWRlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxBYmlsaXR5T3ZlcnJpZGUgPSB1bmRlZmluZWRcbiAgLyoqXG4gICAqIE9yaWdpbmFsIGRlc2VyaWFsaXplZCBjdXN0b20tY29tbWFuZCBjbGllbnQgcGF5bG9hZCwgY2FwdHVyZWQgYmVmb3JlIHJvdXRlXG4gICAqIGZyYW1ld29yayBwYXJhbXMgYXJlIG1lcmdlZCBpbiwgc28gYSB0eXBlZCBjb21tYW5kIG1ldGhvZCByZWNlaXZlcyB0aGUgY2xpZW50J3NcbiAgICogb3duIGFyZ3VtZW50cyByYXRoZXIgdGhhbiB0aGUgcm91dGUgbWV0YWRhdGEuIE9ubHkgc2V0IG9uIHRoZSBzaGFyZWQtZW5kcG9pbnQgcGF0aC5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kQ2xpZW50QXJndW1lbnRzID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBSZXF1ZXN0LXNjb3BlZCBjYWNoZSBmb3Igc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZXMuXG4gICAqIEtleWVkIGJ5IG1vZGVsIGNsYXNzLCB0aGVuIGJ5IHdoZXRoZXIgdGhlIHJlc291cmNlIGlzIGZvciBhIHJlbGF0ZWQgbW9kZWxcbiAgICogKHNvIHNlbGYtcmVmZXJlbnRpYWwgcmVsYXRpb25zaGlwcyBkbyBub3QgYWNjaWRlbnRhbGx5IHJldXNlIHJvb3QgcGFyYW1zKS5cbiAgICogQHR5cGUge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPGJvb2xlYW4sIGltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pj4gfCB1bmRlZmluZWR9ICovXG4gIF9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzID0gdW5kZWZpbmVkXG4gIC8qKlxuICAgKiBPcHRpb25hbCBwZXItaW5zdGFuY2UgaG9vayBpbnZva2VkIGZvciBldmVyeSBzZXJpYWxpemF0aW9uIHJlc291cmNlIGluc3RhbmNlXG4gICAqIHJlc29sdXRpb24uIEludGVuZGVkIGZvciB0ZXN0cyBhbmQgYmVuY2htYXJrczsgYWJzZW50IGluIHByb2R1Y3Rpb24uXG4gICAqIEB0eXBlIHtGcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRGVjb2RlZCByZXF1ZXN0IHBhcmFtcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQYXJhbXMoKSB7XG4gICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZSkge1xuICAgICAgcmV0dXJuIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZVxuICAgIH1cblxuICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXMgfHw9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG5cbiAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBmcm9udGVuZCBtb2RlbCBwYXJhbXMuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBUZW1wb3JhcnkgZnJvbnRlbmQgbW9kZWwgcGFyYW1zLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZXhlY3V0ZWQgd2l0aCB0ZW1wb3JhcnkgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBhc3luYyB3aXRoRnJvbnRlbmRNb2RlbFBhcmFtcyhwYXJhbXMsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgcHJldmlvdXNPdmVycmlkZSA9IHRoaXMuX2Zyb250ZW5kTW9kZWxQYXJhbXNPdmVycmlkZVxuICAgIGNvbnN0IHByZXZpb3VzUGFyYW1zID0gdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc1xuICAgIGNvbnN0IHByZXZpb3VzU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzID0gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc1xuXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc092ZXJyaWRlID0gcGFyYW1zXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtcyA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSB1bmRlZmluZWRcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgPSBwcmV2aW91c092ZXJyaWRlXG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zID0gcHJldmlvdXNQYXJhbXNcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSBwcmV2aW91c1NlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdpdGggZnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBjb250ZXh0LlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdC1zY29wZWQgcGFyYW1zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3Jlc3BvbnNlLmpzXCIpLmRlZmF1bHR9IHJlc3BvbnNlIC0gUmVzcG9uc2UgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBleGVjdXRlZCBpbnNpZGUgcmVzb2x2ZWQgdGVuYW50IGFuZCBhYmlsaXR5IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIHdpdGhGcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQocGFyYW1zLCByZXNwb25zZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCB0ZW5hbnQgPSBjb25maWd1cmF0aW9uLmdldFRlbmFudFJlc29sdmVyKClcbiAgICAgID8gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJGcm9udGVuZCBtb2RlbCByZXF1ZXN0IHRlbmFudCByZXNvbHV0aW9uXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZVRlbmFudCh7XG4gICAgICAgICAgICBwYXJhbXMsXG4gICAgICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKSxcbiAgICAgICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiRnJvbnRlbmQgbW9kZWwgcmVxdWVzdFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBhYmlsaXR5ID0gYXdhaXQgY29uZmlndXJhdGlvbi5yZXNvbHZlQWJpbGl0eSh7XG4gICAgICAgICAgcGFyYW1zLFxuICAgICAgICAgIHJlcXVlc3Q6IHRoaXMucmVxdWVzdCgpLFxuICAgICAgICAgIHJlc3BvbnNlXG4gICAgICAgIH0pXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBQcmV2aW91cyBhYmlsaXR5IG92ZXJyaWRlLlxuICAgICAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICAgICAgY29uc3QgcHJldmlvdXNBYmlsaXR5T3ZlcnJpZGUgPSB0aGlzLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlXG5cbiAgICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSA9IGFiaWxpdHlcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICB0aGlzLl9mcm9udGVuZE1vZGVsQWJpbGl0eU92ZXJyaWRlID0gcHJldmlvdXNBYmlsaXR5T3ZlcnJpZGVcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkgZm9yIGZyb250ZW5kLW1vZGVsIHJlcXVlc3Qgc2NvcGUuXG4gICAqL1xuICBjdXJyZW50QWJpbGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbEFiaWxpdHlPdmVycmlkZSB8fCBzdXBlci5jdXJyZW50QWJpbGl0eSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIGZvciBjb250cm9sbGVyIHJlc291cmNlIGFjdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ2xhc3MoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3NGcm9tQ29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcGFyYW1zID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKClcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0eXBlb2YgcGFyYW1zLm1vZGVsID09PSBcInN0cmluZ1wiID8gcGFyYW1zLm1vZGVsIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29udHJvbGxlck5hbWUgPSB0eXBlb2YgcGFyYW1zLmNvbnRyb2xsZXIgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMuY29udHJvbGxlciA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKGZyb250ZW5kTW9kZWxDbGFzcykgcmV0dXJuIGZyb250ZW5kTW9kZWxDbGFzc1xuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBmcm9udGVuZCBtb2RlbCBjb25maWd1cmVkIGZvciBtb2RlbCAnJHttb2RlbE5hbWUgfHwgXCJ1bmtub3duXCJ9JyBhbmQgY29udHJvbGxlciAnJHtjb250cm9sbGVyTmFtZSB8fCBcInVua25vd25cIn0nLiBFbnN1cmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzIGV4aXN0cyBpbiBzcmMvcmVzb3VyY2VzLyBvciBpcyBsaXN0ZWQgaW4gdGhlIGFiaWxpdHkgcmVzb2x2ZXIuYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7YmFja2VuZFByb2plY3Q6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlLCByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gfCBudWxsfSAtIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIGN1cnJlbnQgY29udHJvbGxlci5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3QgcGFyYW1zID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKClcbiAgICBjb25zdCBtb2RlbE5hbWUgPSB0eXBlb2YgcGFyYW1zLm1vZGVsID09PSBcInN0cmluZ1wiID8gcGFyYW1zLm1vZGVsIDogdW5kZWZpbmVkXG4gICAgY29uc3QgY29udHJvbGxlck5hbWUgPSB0eXBlb2YgcGFyYW1zLmNvbnRyb2xsZXIgPT09IFwic3RyaW5nXCIgPyBwYXJhbXMuY29udHJvbGxlciA6IHVuZGVmaW5lZFxuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlc1dpdGhCdWlsdEluc0ZvckJhY2tlbmRQcm9qZWN0KGJhY2tlbmRQcm9qZWN0KVxuXG4gICAgICBpZiAobW9kZWxOYW1lICYmIG1vZGVsTmFtZS5sZW5ndGggPiAwICYmIHJlc291cmNlc1ttb2RlbE5hbWVdKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1ttb2RlbE5hbWVdXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgICAgICBpZiAoIXJlc291cmNlQ29uZmlndXJhdGlvbiB8fCAhcmVzb3VyY2VDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgJyR7bW9kZWxOYW1lfScgbXVzdCBiZSBhIEZyb250ZW5kTW9kZWxCYXNlUmVzb3VyY2Ugc3ViY2xhc3NgKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgICBtb2RlbE5hbWUsXG4gICAgICAgICAgcmVzb3VyY2VDbGFzcyxcbiAgICAgICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbnRyb2xsZXJOYW1lIHx8IGNvbnRyb2xsZXJOYW1lLmxlbmd0aCA8IDEpIGNvbnRpbnVlXG5cbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VNb2RlbE5hbWUgaW4gcmVzb3VyY2VzKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlRGVmaW5pdGlvbiA9IHJlc291cmNlc1tyZXNvdXJjZU1vZGVsTmFtZV1cbiAgICAgICAgY29uc3QgcmVzb3VyY2VDb25maWd1cmF0aW9uID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcbiAgICAgICAgY29uc3QgcmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uIHx8ICFyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSAnJHtyZXNvdXJjZU1vZGVsTmFtZX0nIG11c3QgYmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzYClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc291cmNlUGF0aCA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChyZXNvdXJjZU1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKVxuXG4gICAgICAgIGlmICh0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1hdGNoZXNDb250cm9sbGVyKHtjb250cm9sbGVyTmFtZSwgcmVzb3VyY2VQYXRofSkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgICAgICBtb2RlbE5hbWU6IHJlc291cmNlTW9kZWxOYW1lLFxuICAgICAgICAgICAgcmVzb3VyY2VDbGFzcyxcbiAgICAgICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvblxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBiYWNrZW5kIHByb2plY3QgbW9kZWwgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYXJncy5iYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tb2RlbE5hbWUgLSBNb2RlbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2JhY2tlbmRQcm9qZWN0OiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uLCBtb2RlbE5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb259IHwgbnVsbH0gLSBGcm9udGVuZCBtb2RlbCByZXNvdXJjZSBjb25maWd1cmF0aW9uIGZvciBtb2RlbCBuYW1lLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtiYWNrZW5kUHJvamVjdCwgbW9kZWxOYW1lfSkge1xuICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcbiAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSByZXNvdXJjZXNbbW9kZWxOYW1lXVxuXG4gICAgaWYgKCFyZXNvdXJjZURlZmluaXRpb24pIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRnJvbURlZmluaXRpb24ocmVzb3VyY2VEZWZpbml0aW9uKVxuICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc0Zyb21EZWZpbml0aW9uKHJlc291cmNlRGVmaW5pdGlvbilcblxuICAgIGlmICghcmVzb3VyY2VDb25maWd1cmF0aW9uIHx8ICFyZXNvdXJjZUNsYXNzKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgbW9kZWxOYW1lLFxuICAgICAgcmVzb3VyY2VDbGFzcyxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt7YmFja2VuZFByb2plY3Q6IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb24sIG1vZGVsTmFtZTogc3RyaW5nLCByZXNvdXJjZUNsYXNzOiBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlLCByZXNvdXJjZUNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbn0gfCBudWxsfSAtIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuIG51bGxcblxuICAgIGlmICh0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKSA9PT0gbW9kZWxDbGFzcykge1xuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JCYWNrZW5kUHJvamVjdE1vZGVsTmFtZSh7XG4gICAgICBiYWNrZW5kUHJvamVjdDogZnJvbnRlbmRNb2RlbFJlc291cmNlLmJhY2tlbmRQcm9qZWN0LFxuICAgICAgbW9kZWxOYW1lOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3ttb2RlbE5hbWU6IHN0cmluZywgcmVzb3VyY2VDbGFzczogaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX19IGZyb250ZW5kTW9kZWxSZXNvdXJjZSAtIEZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBCYWNraW5nIHJlY29yZCBjbGFzcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZXNvdXJjZU1vZGVsQ2xhc3MoZnJvbnRlbmRNb2RlbFJlc291cmNlKSB7XG4gICAgcmV0dXJuIGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY2xhc3MgZnJvbSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIEZyb250ZW5kIG1vZGVsIGNsYXNzIHJlc29sdmVkIGZyb20gYmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ2xhc3NGcm9tQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VNb2RlbENsYXNzKGZyb250ZW5kTW9kZWxSZXNvdXJjZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBmcm9udGVuZCBtb2RlbCBjbGFzcyBhbmQgcmVxdWVzdGVkIHByZWxvYWQgdGFyZ2V0IGNsYXNzZXMgYXJlIGluaXRpYWxpemVkLlxuICAgKiBUaGlzIGhhbmRsZXMgdGhlIGNhc2Ugd2hlcmUgbW9kZWwgaW5pdGlhbGl6YXRpb24gd2FzIHNraXBwZWQgYXQgc3RhcnR1cCAoZS5nLiwgYnJvd3NlciB0ZXN0cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG1vZGVsIGNsYXNzIGlzIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJvbnRlbmRNb2RlbENsYXNzSW5pdGlhbGl6ZWQoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3NGcm9tQ29uZmlndXJhdGlvbigpXG5cbiAgICBpZiAoIW1vZGVsQ2xhc3MpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUmVjb3JkQ2xhc3NJbml0aWFsaXplZChtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2UpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsUHJlbG9hZENsYXNzZXNJbml0aWFsaXplZCh7XG4gICAgICBiYWNrZW5kUHJvamVjdDogZnJvbnRlbmRNb2RlbFJlc291cmNlLmJhY2tlbmRQcm9qZWN0LFxuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIHByZWxvYWQ6IHRoaXMuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgcmVjb3JkIGNsYXNzIGluaXRpYWxpemVkLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5pdGlhbGl6ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgbW9kZWwgY2xhc3MgaXMgcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcm9udGVuZE1vZGVsUmVjb3JkQ2xhc3NJbml0aWFsaXplZChtb2RlbENsYXNzKSB7XG4gICAgaWYgKCFtb2RlbENsYXNzIHx8IG1vZGVsQ2xhc3MuaXNJbml0aWFsaXplZCgpKSByZXR1cm5cblxuICAgIGF3YWl0IG1vZGVsQ2xhc3MuZW5zdXJlSW5pdGlhbGl6ZWQoe2NvbmZpZ3VyYXRpb246IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVuc3VyZSBmcm9udGVuZCBtb2RlbCBwcmVsb2FkIGNsYXNzZXMgaW5pdGlhbGl6ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5CYWNrZW5kUHJvamVjdENvbmZpZ3VyYXRpb259IGFyZ3MuYmFja2VuZFByb2plY3QgLSBCYWNrZW5kIHByb2plY3QgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgd2hvc2UgcHJlbG9hZCB0cmVlIGlzIGJlaW5nIHJlc29sdmVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGx9IGFyZ3MucHJlbG9hZCAtIE5vcm1hbGl6ZWQgcHJlbG9hZCB0cmVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHByZWxvYWQgdGFyZ2V0IGNsYXNzZXMgYXJlIGluaXRpYWxpemVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJvbnRlbmRNb2RlbFByZWxvYWRDbGFzc2VzSW5pdGlhbGl6ZWQoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbENsYXNzLCBwcmVsb2FkfSkge1xuICAgIGlmICghcHJlbG9hZCkgcmV0dXJuXG5cbiAgICBmb3IgKGNvbnN0IFtyZWxhdGlvbnNoaXBOYW1lLCByZWxhdGlvbnNoaXBQcmVsb2FkXSBvZiBPYmplY3QuZW50cmllcyhwcmVsb2FkKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcFByZWxvYWQgPT09IGZhbHNlKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgaWYgKCFyZWxhdGlvbnNoaXApIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gcHJlbG9hZCByZWxhdGlvbnNoaXAgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBUYXJnZXRDbGFzc0luaXRpYWxpemVkKHtcbiAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgIHJlbGF0aW9uc2hpcFxuICAgICAgfSlcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIGlmIChpc1BsYWluT2JqZWN0KHJlbGF0aW9uc2hpcFByZWxvYWQpICYmIE9iamVjdC5rZXlzKHJlbGF0aW9uc2hpcFByZWxvYWQpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBsZXQgbWVzc2FnZSA9IGBDYW5ub3QgcHJlbG9hZCBuZXN0ZWQgcmVsYXRpb25zaGlwcyB0aHJvdWdoIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9IGJlY2F1c2UgaXRzIHRhcmdldCBtb2RlbCBjbGFzcyBjb3VsZCBub3QgYmUgcmVzb2x2ZWRgXG5cbiAgICAgICAgICBpZiAocmVsYXRpb25zaGlwLmdldFBvbHltb3JwaGljKCkgJiYgcmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICAgICAgbWVzc2FnZSA9IGBDYW5ub3QgcHJlbG9hZCBuZXN0ZWQgcmVsYXRpb25zaGlwcyB0aHJvdWdoIHBvbHltb3JwaGljIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YFxuICAgICAgICAgIH1cblxuICAgICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKG1lc3NhZ2UpXG4gICAgICAgIH1cblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIWlzUGxhaW5PYmplY3QocmVsYXRpb25zaGlwUHJlbG9hZCkpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFByZWxvYWRDbGFzc2VzSW5pdGlhbGl6ZWQoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgICAgcHJlbG9hZDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmR9ICovIChyZWxhdGlvbnNoaXBQcmVsb2FkKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbnN1cmUgZnJvbnRlbmQgbW9kZWwgcmVsYXRpb25zaGlwIHRhcmdldCBjbGFzcyBpbml0aWFsaXplZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkJhY2tlbmRQcm9qZWN0Q29uZmlndXJhdGlvbn0gYXJncy5iYWNrZW5kUHJvamVjdCAtIEJhY2tlbmQgcHJvamVjdCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIFRhcmdldCBtb2RlbCBjbGFzcywgd2hlbiBhdmFpbGFibGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcm9udGVuZE1vZGVsUmVsYXRpb25zaGlwVGFyZ2V0Q2xhc3NJbml0aWFsaXplZCh7YmFja2VuZFByb2plY3QsIHJlbGF0aW9uc2hpcH0pIHtcbiAgICBpZiAocmVsYXRpb25zaGlwLnRocm91Z2gpIHtcbiAgICAgIGNvbnN0IHRocm91Z2hSZWxhdGlvbnNoaXAgPSByZWxhdGlvbnNoaXAuZ2V0TW9kZWxDbGFzcygpLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAudGhyb3VnaClcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFJlbGF0aW9uc2hpcFRhcmdldENsYXNzSW5pdGlhbGl6ZWQoe1xuICAgICAgICBiYWNrZW5kUHJvamVjdCxcbiAgICAgICAgcmVsYXRpb25zaGlwOiB0aHJvdWdoUmVsYXRpb25zaGlwXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgIGJhY2tlbmRQcm9qZWN0LFxuICAgICAgcmVsYXRpb25zaGlwXG4gICAgfSlcblxuICAgIGlmICghdGFyZ2V0TW9kZWxDbGFzcykgcmV0dXJuIG51bGxcblxuICAgIGF3YWl0IHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbFJlY29yZENsYXNzSW5pdGlhbGl6ZWQodGFyZ2V0TW9kZWxDbGFzcylcblxuICAgIHJldHVybiB0YXJnZXRNb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZWxhdGlvbnNoaXAgdGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSBhcmdzLmJhY2tlbmRQcm9qZWN0IC0gQmFja2VuZCBwcm9qZWN0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IC0gVGFyZ2V0IG1vZGVsIGNsYXNzLCB3aGVuIGF2YWlsYWJsZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzKHtiYWNrZW5kUHJvamVjdCwgcmVsYXRpb25zaGlwfSkge1xuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0UG9seW1vcnBoaWMoKSAmJiByZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09PSBcImJlbG9uZ3NUb1wiKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5rbGFzcykgcmV0dXJuIHJlbGF0aW9uc2hpcC5rbGFzc1xuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5jbGFzc05hbWUpIHtcbiAgICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvckJhY2tlbmRQcm9qZWN0TW9kZWxOYW1lKHtcbiAgICAgICAgYmFja2VuZFByb2plY3QsXG4gICAgICAgIG1vZGVsTmFtZTogcmVsYXRpb25zaGlwLmNsYXNzTmFtZVxuICAgICAgfSlcbiAgICAgIGNvbnN0IHJlc291cmNlTW9kZWxDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA/IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhmcm9udGVuZE1vZGVsUmVzb3VyY2UpIDogbnVsbFxuXG4gICAgICBpZiAocmVzb3VyY2VNb2RlbENsYXNzKSByZXR1cm4gcmVzb3VyY2VNb2RlbENsYXNzXG5cbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWRNb2RlbENsYXNzID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0TW9kZWxDbGFzc2VzKClbcmVsYXRpb25zaGlwLmNsYXNzTmFtZV1cblxuICAgICAgaWYgKHJlZ2lzdGVyZWRNb2RlbENsYXNzKSByZXR1cm4gcmVnaXN0ZXJlZE1vZGVsQ2xhc3NcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgcmV0dXJuIHRhcmdldE1vZGVsQ2xhc3MgfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsTmFtZSAtIE1vZGVsIGNsYXNzIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc291cmNlRGVmaW5pdGlvbiAtIFJlc291cmNlIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTm9ybWFsaXplZCByZXNvdXJjZSBwYXRoLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlUGF0aChtb2RlbE5hbWUsIHJlc291cmNlRGVmaW5pdGlvbikge1xuICAgIHJldHVybiBmcm9udGVuZE1vZGVsUmVzb3VyY2VQYXRoKG1vZGVsTmFtZSwgcmVzb3VyY2VEZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2UgbWF0Y2hlcyBjb250cm9sbGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29udHJvbGxlck5hbWUgLSBDb250cm9sbGVyIG5hbWUgZnJvbSBwYXJhbXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlUGF0aCAtIFJlc291cmNlIHBhdGggZnJvbSBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlc291cmNlIHBhdGggbWF0Y2hlcyBjdXJyZW50IGNvbnRyb2xsZXIuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VNYXRjaGVzQ29udHJvbGxlcih7Y29udHJvbGxlck5hbWUsIHJlc291cmNlUGF0aH0pIHtcbiAgICBjb25zdCBub3JtYWxpemVkQ29udHJvbGxlciA9IGNvbnRyb2xsZXJOYW1lLnJlcGxhY2UoL15cXC8rfFxcLyskL2csIFwiXCIpXG4gICAgY29uc3Qgbm9ybWFsaXplZFJlc291cmNlUGF0aCA9IHJlc291cmNlUGF0aC5yZXBsYWNlKC9eXFwvK3xcXC8rJC9nLCBcIlwiKVxuXG4gICAgaWYgKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGggPT09IG5vcm1hbGl6ZWRDb250cm9sbGVyKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGguZW5kc1dpdGgoYC8ke25vcm1hbGl6ZWRDb250cm9sbGVyfWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSAtIEJhY2tlbmQgcmVzb3VyY2UgaW5zdGFuY2UgZm9yIGN1cnJlbnQgZnJvbnRlbmQtbW9kZWwgYWN0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIGNvbnRyb2xsZXIgJyR7dGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuY29udHJvbGxlcn0nYClcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZUFyZ3MgPSB7XG4gICAgICBhYmlsaXR5OiB0aGlzLmN1cnJlbnRBYmlsaXR5KCksXG4gICAgICBjb250cm9sbGVyOiB0aGlzLFxuICAgICAgY29udGV4dDoge1xuICAgICAgICAuLi4odGhpcy5jdXJyZW50QWJpbGl0eSgpPy5nZXRDb250ZXh0KCkgfHwge30pLFxuICAgICAgICBwYXJhbXM6IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLFxuICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKVxuICAgICAgfSxcbiAgICAgIGxvY2FsczogdGhpcy5jdXJyZW50QWJpbGl0eSgpPy5nZXRMb2NhbHMoKSB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICBtb2RlbE5hbWU6IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5tb2RlbE5hbWUsXG4gICAgICBwYXJhbXM6IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3MpXG5cbiAgICByZXR1cm4gbmV3IFJlc291cmNlQ2xhc3MocmVzb3VyY2VBcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb259IC0gRnJvbnRlbmQgbW9kZWwgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpIHtcbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnByaW1hcnlLZXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYWJpbGl0eSBhY3Rpb24uXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBYmlsaXR5IGFjdGlvbiBjb25maWd1cmVkIGZvciB0aGUgZnJvbnRlbmQgYWN0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEFiaWxpdHlBY3Rpb24oYWN0aW9uKSB7XG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGZyb250ZW5kIG1vZGVsIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gZm9yIGNvbnRyb2xsZXIgJyR7dGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuY29udHJvbGxlcn0nYClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXRpZXMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uLmFiaWxpdGllc1xuXG4gICAgaWYgKCFhYmlsaXRpZXMgfHwgdHlwZW9mIGFiaWxpdGllcyAhPT0gXCJvYmplY3RcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSAnJHtmcm9udGVuZE1vZGVsUmVzb3VyY2UubW9kZWxOYW1lfScgbXVzdCBkZWZpbmUgYW4gJ2FiaWxpdGllcycgb2JqZWN0YClcbiAgICB9XG5cbiAgICBjb25zdCBhYmlsaXR5S2V5ID0gYWN0aW9uID09PSBcImF0dGFjaFwiXG4gICAgICA/IFwidXBkYXRlXCJcbiAgICAgIDogKChhY3Rpb24gPT09IFwiZG93bmxvYWRcIiB8fCBhY3Rpb24gPT09IFwidXJsXCIgfHwgYWN0aW9uID09PSBcImF0dGFjaG1lbnRMaXN0XCIpID8gXCJmaW5kXCIgOiBhY3Rpb24pXG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IGFiaWxpdGllc1thYmlsaXR5S2V5XVxuXG4gICAgaWYgKHR5cGVvZiBhYmlsaXR5QWN0aW9uICE9PSBcInN0cmluZ1wiIHx8IGFiaWxpdHlBY3Rpb24ubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXNvdXJjZSAnJHtmcm9udGVuZE1vZGVsUmVzb3VyY2UubW9kZWxOYW1lfScgbXVzdCBkZWZpbmUgYWJpbGl0aWVzLiR7YWJpbGl0eUtleX1gKVxuICAgIH1cblxuICAgIHJldHVybiBhYmlsaXR5QWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBhYmlsaXR5IGF1dGhvcml6ZWQgcXVlcnkuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHt7cnVsZVF1ZXJ5RmFjdG9yeT86ICgpID0+IGltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59fSBbb3B0aW9uc10gLSBBdXRob3JpemF0aW9uIHF1ZXJ5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIEF1dGhvcml6ZWQgcXVlcnkgZm9yIHRoZSBhY3Rpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeShhY3Rpb24sIHtydWxlUXVlcnlGYWN0b3J5fSA9IHt9KSB7XG4gICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHRoaXMuZnJvbnRlbmRNb2RlbEFiaWxpdHlBY3Rpb24oYWN0aW9uKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJ1bGVRdWVyeUZhY3RvcnkpIHJldHVybiBtb2RlbENsYXNzLmFjY2Vzc2libGVGb3IoYWJpbGl0eUFjdGlvbiwgdGhpcy5jdXJyZW50QWJpbGl0eSgpKVxuXG4gICAgY29uc3QgYWJpbGl0eSA9IHRoaXMuY3VycmVudEFiaWxpdHkoKVxuXG4gICAgaWYgKCFhYmlsaXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGFiaWxpdHkgaW4gY29udGV4dCBmb3IgJHttb2RlbENsYXNzLm5hbWV9LiBDb25maWd1cmUgYW4gYWJpbGl0eSByZXNvbHZlciBvbiB0aGUgcmVxdWVzdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIGFiaWxpdHkuYXBwbHlUb1F1ZXJ5KHtcbiAgICAgIGFjdGlvbjogYWJpbGl0eUFjdGlvbixcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBxdWVyeTogbW9kZWxDbGFzcy5fbmV3UXVlcnkoKSxcbiAgICAgIHJ1bGVRdWVyeUZhY3RvcnlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgYXV0aG9yaXplZCBxdWVyeS5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3tydWxlUXVlcnlGYWN0b3J5PzogKCkgPT4gaW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn19IFtvcHRpb25zXSAtIEF1dGhvcml6YXRpb24gcXVlcnkgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IC0gQXV0aG9yaXplZCBxdWVyeSBmb3IgdGhlIGFjdGlvbi5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxBdXRob3JpemVkUXVlcnkoYWN0aW9uLCBvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKHJlc291cmNlLmF1dGhvcml6ZWRRdWVyeSAhPT0gRnJvbnRlbmRNb2RlbEJhc2VSZXNvdXJjZS5wcm90b3R5cGUuYXV0aG9yaXplZFF1ZXJ5KSB7XG4gICAgICByZXR1cm4gcmVzb3VyY2UuYXV0aG9yaXplZFF1ZXJ5KGFjdGlvbiwgb3B0aW9ucylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsQWJpbGl0eUF1dGhvcml6ZWRRdWVyeShhY3Rpb24sIG9wdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBwcmltYXJ5IGtleSB2YWx1ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbCAtIE1vZGVsIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZX0gLSBQcmltYXJ5IGtleSB2YWx1ZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG5cbiAgICByZXR1cm4gcmVhZE1vZGVsUHJpbWFyeUtleVZhbHVlKHByaW1hcnlLZXksIChhdHRyaWJ1dGVOYW1lKSA9PiBtb2RlbC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGF1dGhvcml6ZWQgaWRlbnRpdGllcyBmcm9tIGEgY2FuZGlkYXRlIGNvaG9ydCB3aXRob3V0IHBlci1yZWNvcmQgcXVlcmllcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiKS5Nb2RlbFByaW1hcnlLZXlWYWx1ZVtdfSBhcmdzLmlkZW50aXRpZXMgLSBDYW5kaWRhdGUgaWRlbnRpdGllcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBpZGVudGl0eSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIikuTW9kZWxQcmltYXJ5S2V5RGVmaW5pdGlvbn0gYXJncy5wcmltYXJ5S2V5IC0gSWRlbnRpdHkgZGVmaW5pdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBhcmdzLnF1ZXJ5IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2V0PHN0cmluZz4+fSAtIENhbm9uaWNhbCBhdXRob3JpemVkIGlkZW50aXR5IGtleXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQXV0aG9yaXplZElkZW50aXR5U2V0KHtpZGVudGl0aWVzLCBtb2RlbENsYXNzLCBwcmltYXJ5S2V5LCBxdWVyeX0pIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkpIHtcbiAgICAgIGNvbnN0IGF1dGhvcml6ZWRJZHMgPSBhd2FpdCBxdWVyeVxuICAgICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogaWRlbnRpdGllc30pXG4gICAgICAgIC5wbHVjayhwcmltYXJ5S2V5KVxuXG4gICAgICByZXR1cm4gbmV3IFNldChhdXRob3JpemVkSWRzLm1hcCgodmFsdWUpID0+IG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIHZhbHVlKSkpXG4gICAgfVxuXG4gICAgY29uc3QgbWF4Q29tcG9zaXRlQ29ob3J0U2l6ZSA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocXVlcnkuZHJpdmVyLm1heEluQ2xhdXNlVmFsdWVzKCkgLyBwcmltYXJ5S2V5Lmxlbmd0aCkpXG4gICAgY29uc3QgY29ob3J0cyA9IHF1ZXJ5LmRyaXZlci5jaHVua1ZhbHVlcyhpZGVudGl0aWVzLCAoY29ob3J0KSA9PiBxdWVyeVxuICAgICAgLmNsb25lKClcbiAgICAgIC53aGVyZShjb21wb3NpdGVNb2RlbFByaW1hcnlLZXlDb2hvcnRTcWwoe21vZGVsQ2xhc3MsIHByaW1hcnlLZXksIHF1ZXJ5LCB2YWx1ZXM6IGNvaG9ydH0pKVxuICAgICAgLnRvU3FsKCksIHttYXhDb3VudDogbWF4Q29tcG9zaXRlQ29ob3J0U2l6ZX0pXG4gICAgY29uc3QgYXV0aG9yaXplZElkZW50aXR5S2V5cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBjb2hvcnQgb2YgY29ob3J0cykge1xuICAgICAgY29uc3QgYXV0aG9yaXplZE1vZGVscyA9IGF3YWl0IHF1ZXJ5XG4gICAgICAgIC5jbG9uZSgpXG4gICAgICAgIC53aGVyZShjb21wb3NpdGVNb2RlbFByaW1hcnlLZXlDb2hvcnRTcWwoe21vZGVsQ2xhc3MsIHByaW1hcnlLZXksIHF1ZXJ5LCB2YWx1ZXM6IGNvaG9ydH0pKVxuICAgICAgICAudG9BcnJheSgpXG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgYXV0aG9yaXplZE1vZGVscykge1xuICAgICAgICBjb25zdCBpZGVudGl0eSA9IHJlYWRNb2RlbFByaW1hcnlLZXlWYWx1ZShwcmltYXJ5S2V5LCAoYXR0cmlidXRlTmFtZSkgPT4gbW9kZWwucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcblxuICAgICAgICBhdXRob3JpemVkSWRlbnRpdHlLZXlzLmFkZChtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBpZGVudGl0eSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGF1dGhvcml6ZWRJZGVudGl0eUtleXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGZpbHRlciBhdXRob3JpemVkIG1vZGVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFyZ3MuYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gYXJncy5tb2RlbHMgLSBDYW5kaWRhdGUgbW9kZWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIEF1dGhvcml6ZWQgbW9kZWxzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbiwgbW9kZWxzfSkge1xuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm4gbW9kZWxzXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG5cbiAgICBjb25zdCBpZGVudGl0aWVzID0gbW9kZWxzLm1hcCgobW9kZWwpID0+IHRoaXMuZnJvbnRlbmRNb2RlbFByaW1hcnlLZXlWYWx1ZShtb2RlbCkpXG4gICAgY29uc3QgYXV0aG9yaXplZElkcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRJZGVudGl0eVNldCh7XG4gICAgICBpZGVudGl0aWVzLFxuICAgICAgbW9kZWxDbGFzczogdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSxcbiAgICAgIHByaW1hcnlLZXksXG4gICAgICBxdWVyeTogdGhpcy5mcm9udGVuZE1vZGVsQXV0aG9yaXplZFF1ZXJ5KGFjdGlvbilcbiAgICB9KVxuXG4gICAgcmV0dXJuIG1vZGVscy5maWx0ZXIoKG1vZGVsKSA9PiBhdXRob3JpemVkSWRzLmhhcyhtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCB0aGlzLmZyb250ZW5kTW9kZWxQcmltYXJ5S2V5VmFsdWUobW9kZWwpKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gZnJvbnRlbmQgbW9kZWwgYmVmb3JlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtcImluZGV4XCIgfCBcImZpbmRcIiB8IFwiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCIgfCBcImF0dGFjaFwiIHwgXCJhdHRhY2htZW50TGlzdFwiIHwgXCJkb3dubG9hZFwiIHwgXCJ1cmxcIn0gYWN0aW9uIC0gRnJvbnRlbmQgYWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIGFjdGlvbiBzaG91bGQgY29udGludWUuXG4gICAqL1xuICBhc3luYyBydW5Gcm9udGVuZE1vZGVsQmVmb3JlQWN0aW9uKGFjdGlvbikge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKS5iZWZvcmVBY3Rpb24oYWN0aW9uKVxuXG4gICAgcmV0dXJuIHJlc3VsdCAhPT0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGZpbmQgcmVjb3JkLlxuICAgKiBAcGFyYW0ge1wiZmluZFwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleVZhbHVlfSBpZCAtIFJlY29yZCBpZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGw+fSAtIExvY2F0ZWQgbW9kZWwgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoYWN0aW9uLCBpZCkge1xuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLmZpbmQoYWN0aW9uLCBpZClcblxuICAgIGlmICghbW9kZWwpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBhdXRob3JpemVkTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyQXV0aG9yaXplZE1vZGVscyh7YWN0aW9uLCBtb2RlbHM6IFttb2RlbF19KVxuXG4gICAgcmV0dXJuIGF1dGhvcml6ZWRNb2RlbHNbMF0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY3JlYXRlIHJlY29yZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBDcmVhdGUgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBbbmVzdGVkQXR0cmlidXRlc10gLSBPcHRpb25hbCBuZXN0ZWQtYXR0cmlidXRlIHBheWxvYWQgZm9yIGNhc2NhZGluZyB3cml0ZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW2F0dGFjaG1lbnRzXSAtIE9wdGlvbmFsIGF0dGFjaG1lbnQgcGF5bG9hZHMga2V5ZWQgYnkgYXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbD59IC0gQ3JlYXRlZCBtb2RlbCB3aGVuIGF1dGhvcml6ZWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ3JlYXRlUmVjb3JkKGF0dHJpYnV0ZXMsIG5lc3RlZEF0dHJpYnV0ZXMgPSBudWxsLCBhdHRhY2htZW50cyA9IG51bGwpIHtcbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgcmVzb3VyY2UuY3JlYXRlKGF0dHJpYnV0ZXMsIHthdHRhY2htZW50cywgbmVzdGVkQXR0cmlidXRlcywgY29udHJvbGxlcjogdGhpc30pXG5cbiAgICBjb25zdCBhdXRob3JpemVkTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyQXV0aG9yaXplZE1vZGVscyh7YWN0aW9uOiBcImNyZWF0ZVwiLCBtb2RlbHM6IFttb2RlbF19KVxuXG4gICAgaWYgKGF1dGhvcml6ZWRNb2RlbHMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGF1dGhvcml6ZWRNb2RlbHNbMF1cbiAgICB9XG5cbiAgICBhd2FpdCByZXNvdXJjZS5oYW5kbGVVbmF1dGhvcml6ZWRDcmVhdGVkTW9kZWwobW9kZWwpXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gLSBGcm9udGVuZCBtb2RlbCByZWNvcmRzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbFJlY29yZHMoKSB7XG4gICAgY29uc3QgbW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpLnJlY29yZHMoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlckF1dGhvcml6ZWRNb2RlbHMoe2FjdGlvbjogXCJpbmRleFwiLCBtb2RlbHN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcHJlbG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IG51bGx9IC0gRnJvbnRlbmQgcHJlbG9hZCBkYXRhLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFByZWxvYWQoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxQcmVsb2FkKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnByZWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4gfCBudWxsfSAtIEZyb250ZW5kIHNlbGVjdCBkYXRhLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdCgpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFNlbGVjdCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5zZWxlY3QsIHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCkuZ2V0TW9kZWxOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3RzIGV4dHJhLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nW10+IHwgbnVsbH0gLSBGcm9udGVuZCBleHRyYS1zZWxlY3QgZGF0YSAoZGVmYXVsdHMgcGx1cyB0aGVzZSksIGtleWVkIGJ5IG1vZGVsIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsU2VsZWN0KHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnNlbGVjdHNFeHRyYSwgdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHNlYXJjaGVzLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFNlYXJjaFtdfSAtIEZyb250ZW5kIHNlYXJjaCBmaWx0ZXJzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlYXJjaGVzKCkge1xuICAgIHJldHVybiBub3JtYWxpemVGcm9udGVuZE1vZGVsU2VhcmNoZXModGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKCkuc2VhcmNoZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCB3aGVyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gRnJvbnRlbmQgd2hlcmUgZmlsdGVycy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxXaGVyZSgpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFdoZXJlKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLndoZXJlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmFuc2Fjay5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gRnJvbnRlbmQgUmFuc2FjayBmaWx0ZXJzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJhbnNhY2soKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxSYW5zYWNrKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLnJhbnNhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBqb2lucy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IC0gRnJvbnRlbmQgam9pbnMgZGVzY3JpcHRvcnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsSm9pbnMoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxKb2lucyh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5qb2lucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHNvcnQuXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsU29ydFtdfSAtIEZyb250ZW5kIHNvcnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU29ydCgpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIG5vcm1hbGl6ZVF1ZXJ5U29ydCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5zb3J0KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGdyb3VwLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEdyb3VwW119IC0gRnJvbnRlbmQgZ3JvdXAgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsR3JvdXAoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBub3JtYWxpemVRdWVyeUdyb3VwKHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLmdyb3VwKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBhZ2luYXRpb24uXG4gICAqIEByZXR1cm5zIHtGcm9udGVuZE1vZGVsUGFnaW5hdGlvbn0gLSBGcm9udGVuZCBwYWdpbmF0aW9uIHBhcmFtcy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKCkge1xuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG5cbiAgICByZXR1cm4gbm9ybWFsaXplRnJvbnRlbmRNb2RlbFBhZ2luYXRpb24oe1xuICAgICAgbGltaXQ6IHBhcmFtcy5saW1pdCxcbiAgICAgIG9mZnNldDogcGFyYW1zLm9mZnNldCxcbiAgICAgIHBhZ2U6IHBhcmFtcy5wYWdlLFxuICAgICAgcGVyUGFnZTogcGFyYW1zLnBlclBhZ2VcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZGlzdGluY3QuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgbnVsbH0gLSBGcm9udGVuZCBkaXN0aW5jdCBmbGFnIHdoZW4gcHJvdmlkZWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRGlzdGluY3QoKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUZyb250ZW5kTW9kZWxEaXN0aW5jdCh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5kaXN0aW5jdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIHBsdWNrLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbFBsdWNrW119IC0gRnJvbnRlbmQgcGx1Y2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUGx1Y2soKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBsdWNrID0gbm9ybWFsaXplUXVlcnlQbHVjayh0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5wbHVjaylcblxuICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUGx1Y2tEZWZpbml0aW9uc0FsbG93ZWQocGx1Y2spXG5cbiAgICAgIHJldHVybiBwbHVja1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNvdW50IHJlcXVlc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdCBhc2tzIGZvciBhbiBhZ2dyZWdhdGUgY291bnQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQ291bnRSZXF1ZXN0ZWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLmNvdW50ID09PSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCB3aXRoIGNvdW50LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fVxuICAgKiAgIEZyb250ZW5kIHdpdGhDb3VudCBlbnRyaWVzLiBFbXB0eSBhcnJheSB3aGVuIG5vdCByZXF1ZXN0ZWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsV2l0aENvdW50KCkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLndpdGhDb3VudFxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJhdykpIHJldHVybiBbXVxuXG4gICAgLyoqXG4gICAgICogRW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgcmVsYXRpb25zaGlwTmFtZTogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgIGNvbnN0IGVudHJpZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiByYXcpIHtcbiAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiKSBjb250aW51ZVxuICAgICAgaWYgKHR5cGVvZiBlbnRyeS5hdHRyaWJ1dGVOYW1lICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5LmF0dHJpYnV0ZU5hbWUubGVuZ3RoID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKHR5cGVvZiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5LnJlbGF0aW9uc2hpcE5hbWUubGVuZ3RoID09PSAwKSBjb250aW51ZVxuXG4gICAgICBlbnRyaWVzLnB1c2goe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBlbnRyeS5hdHRyaWJ1dGVOYW1lLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lOiBlbnRyeS5yZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICB3aGVyZTogZW50cnkud2hlcmUgJiYgdHlwZW9mIGVudHJ5LndoZXJlID09PSBcIm9iamVjdFwiID8gZW50cnkud2hlcmUgOiB1bmRlZmluZWRcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlIGFuIGVudHJ5IGZyb20gdGhlIGZyb250ZW5kLW1vZGVsIGBhYmlsaXRpZXNgIHBheWxvYWQgdG9cbiAgICogaXRzIGJhY2tlbmQgbW9kZWwgY2xhc3MgYnkgbG9va2luZyB1cCB0aGUgcmVzb3VyY2UgYnkgbW9kZWxOYW1lXG4gICAqIGFjcm9zcyBhbGwgY29uZmlndXJlZCBiYWNrZW5kIHByb2plY3RzLiBSZXR1cm5zIG51bGwgd2hlbiBub1xuICAgKiByZXNvdXJjZSBtYXRjaGVzIHRoZSB1c2VyLXByb3ZpZGVkIGFiaWxpdHkgZW50cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBGcm9udGVuZCBtb2RlbCBuYW1lIGZyb20gYW4gYWJpbGl0eSByZXF1ZXN0LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAtIEJhY2tlbmQgbW9kZWwgY2xhc3MgZXhwb3NlZCB1bmRlciB0aGF0IGZyb250ZW5kIG5hbWUsIGlmIHByZXNlbnQuXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENsYXNzRm9yQWJpbGl0aWVzKG1vZGVsTmFtZSkge1xuICAgIGlmICh0eXBlb2YgbW9kZWxOYW1lICE9PSBcInN0cmluZ1wiIHx8IG1vZGVsTmFtZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpXG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmRQcm9qZWN0IG9mIGJhY2tlbmRQcm9qZWN0cykge1xuICAgICAgY29uc3QgZnJvbnRlbmRNb2RlbHMgPSBmcm9udGVuZE1vZGVsUmVzb3VyY2VzRm9yQmFja2VuZFByb2plY3QoYmFja2VuZFByb2plY3QpXG4gICAgICBjb25zdCByZXNvdXJjZURlZmluaXRpb24gPSBmcm9udGVuZE1vZGVsc1ttb2RlbE5hbWVdXG5cbiAgICAgIGlmICghcmVzb3VyY2VEZWZpbml0aW9uKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pXG4gICAgICBpZiAoIXJlc291cmNlQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGcm9udGVuZCBtb2RlbCAnJHttb2RlbE5hbWV9JyByZXNvdXJjZSBkZWZpbml0aW9uIG11c3QgYmUgYSBGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlIHN1YmNsYXNzLmApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNvdXJjZUNsYXNzLm1vZGVsQ2xhc3MoKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdCBldmVyeSBsb2FkZWQgcmVjb3JkIHdob3NlIGBnZXRNb2RlbE5hbWUoKWAgbWF0Y2hlcyB0aGVcbiAgICogcmVxdWVzdGVkIG5hbWUsIHdhbGtpbmcgYWNyb3NzIHRoZSByb290LWxldmVsIHNsaWNlIHBsdXMgYW55XG4gICAqIHByZWxvYWRlZCByZWxhdGlvbnNoaXBzIGF0IGFueSBkZXB0aC4gVXNlZCB0byBldmFsdWF0ZSBwZXItcmVjb3JkXG4gICAqIGFiaWxpdGllcyBhZ2FpbnN0IG5lc3RlZCBwcmVsb2FkZWQgY2hpbGRyZW4gd2l0aCBhIHNpbmdsZSBiYXRjaGVkXG4gICAqIHF1ZXJ5IHBlciAobW9kZWxDbGFzcywgYWN0aW9uKSBwYWlyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gcm9vdE1vZGVscyAtIExvYWRlZCByb290cyB3aG9zZSByZWxhdGlvbnNoaXAgZ3JhcGhzIHNob3VsZCBiZSB0cmF2ZXJzZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBNb2RlbCBuYW1lIHJlY29yZHMgbXVzdCBtYXRjaC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gLSBNYXRjaGluZyByZWNvcmRzIHJlYWNoYWJsZSBmcm9tIHRoZSBsb2FkZWQgcm9vdHMuXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbENvbGxlY3RSZWNvcmRzRm9yTmFtZShyb290TW9kZWxzLCBtb2RlbE5hbWUpIHtcbiAgICAvKipcbiAgICAgKiBPdXQuXG4gICAgICogQHR5cGUge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gKi9cbiAgICBjb25zdCBvdXQgPSBbXVxuICAgIC8qKlxuICAgICAqIFNlZW4uXG4gICAgICogQHR5cGUge1NldDxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBzZWVuID0gbmV3IFNldCgpXG5cbiAgICAvKipcbiAgICAgKiBXYWxrLlxuICAgICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGwgfCB1bmRlZmluZWR9IHJlY29yZCAtIExvYWRlZCByZWNvcmQgd2hvc2UgcmVsYXRpb25zaGlwIGdyYXBoIHNob3VsZCBiZSB2aXNpdGVkLlxuICAgICAqL1xuICAgIGNvbnN0IHdhbGsgPSAocmVjb3JkKSA9PiB7XG4gICAgICBpZiAoIXJlY29yZCB8fCB0eXBlb2YgcmVjb3JkICE9PSBcIm9iamVjdFwiKSByZXR1cm5cbiAgICAgIGlmIChzZWVuLmhhcyhyZWNvcmQpKSByZXR1cm5cbiAgICAgIHNlZW4uYWRkKHJlY29yZClcblxuICAgICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlY29yZC5nZXRNb2RlbENsYXNzKClcbiAgICAgIGlmIChNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpID09PSBtb2RlbE5hbWUpIHtcbiAgICAgICAgb3V0LnB1c2gocmVjb3JkKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBzTWFwID0gTW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcblxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIG9mIE9iamVjdC5rZXlzKHJlbGF0aW9uc2hpcHNNYXApKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlY29yZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgY29uc3QgbG9hZGVkID0gcmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcbiAgICAgICAgaWYgKGxvYWRlZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGxvYWRlZCkgd2FsayhjaGlsZClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3YWxrKGxvYWRlZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgcm9vdCBvZiByb290TW9kZWxzKSB3YWxrKHJvb3QpXG5cbiAgICByZXR1cm4gb3V0XG4gIH1cblxuICAvKipcbiAgICogRXZhbHVhdGUgZXZlcnkgYWJpbGl0eSByZXF1ZXN0ZWQgdmlhIHRoZSBmcm9udGVuZCBgYWJpbGl0aWVzYFxuICAgKiBwYXJhbSBhZ2FpbnN0IHRoZSBsb2FkZWQgbW9kZWwgY29ob3J0IChwbHVzIGFueSBwcmVsb2FkZWRcbiAgICogY2hpbGRyZW4pLCBhdHRhY2hpbmcgdGhlIHJlc3VsdHMgdG8gZWFjaCByZWNvcmQgdmlhXG4gICAqIGBfc2V0Q29tcHV0ZWRBYmlsaXR5YC4gUnVucyBvbmUgYmF0Y2hlZCBgYXV0aG9yaXplZCBxdWVyeSArIHBsdWNrYFxuICAgKiBwZXIgKG1vZGVsQ2xhc3MsIGFjdGlvbikgcGFpciwgcmVnYXJkbGVzcyBvZiBob3cgbWFueSByZWNvcmRzXG4gICAqIHdlcmUgbG9hZGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHRbXX0gcm9vdE1vZGVscyAtIExvYWRlZCByb290cyB0aGF0IHJlY2VpdmUgY29tcHV0ZWQgYWJpbGl0eSByZXN1bHRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxDb21wdXRlQWJpbGl0aWVzKHJvb3RNb2RlbHMpIHtcbiAgICBjb25zdCBlbnRyaWVzID0gdGhpcy5mcm9udGVuZE1vZGVsQWJpbGl0aWVzKClcbiAgICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVyblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyb290TW9kZWxzKSB8fCByb290TW9kZWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG4gICAgaWYgKCFhYmlsaXR5KSByZXR1cm5cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxDbGFzc0ZvckFiaWxpdGllcyhlbnRyeS5tb2RlbE5hbWUpXG4gICAgICBpZiAoIW1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsQ29sbGVjdFJlY29yZHNGb3JOYW1lKHJvb3RNb2RlbHMsIGVudHJ5Lm1vZGVsTmFtZSlcbiAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkgY29udGludWVcblxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG5cbiAgICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIGVudHJ5LmFjdGlvbnMpIHtcbiAgICAgICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICAgICAgbGV0IGFsbG93ZWRJZHNcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBhdXRob3JpemVkUXVlcnkgPSBtb2RlbENsYXNzLmFjY2Vzc2libGVGb3IoYWN0aW9uLCBhYmlsaXR5KVxuXG4gICAgICAgICAgY29uc3QgaWRlbnRpdGllcyA9IGNhbmRpZGF0ZXMubWFwKChyZWNvcmQpID0+IHJlY29yZC5pZCgpKVxuXG4gICAgICAgICAgYWxsb3dlZElkcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRJZGVudGl0eVNldCh7XG4gICAgICAgICAgICBpZGVudGl0aWVzLFxuICAgICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICAgIHByaW1hcnlLZXksXG4gICAgICAgICAgICBxdWVyeTogYXV0aG9yaXplZFF1ZXJ5XG4gICAgICAgICAgfSlcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBBbiBhYmlsaXR5IHdpdGggbm8gYWxsb3cgcnVsZXMgZm9yIHRoZSBhY3Rpb24gdGhyb3dzIHZpYVxuICAgICAgICAgIC8vIGBhY2Nlc3NpYmxlRm9yYDsgdHJlYXQgYXMgYSB1bml2ZXJzYWwgZGVueSBzbyB0aGUgZnJvbnRlbmRcbiAgICAgICAgICAvLyBnZXRzIGBjYW4oYWN0aW9uKSA9PT0gZmFsc2VgIGZvciBldmVyeSBjYW5kaWRhdGUsIGluc3RlYWRcbiAgICAgICAgICAvLyBvZiBzdXJmYWNpbmcgYW4gZXJyb3IgdGhhdCB0aGUgVUkgY2FuJ3QgYWN0IG9uLlxuICAgICAgICAgIHZvaWQgZXJyb3JcbiAgICAgICAgICBhbGxvd2VkSWRzID0gbmV3IFNldCgpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBjYW5kaWRhdGVzKSB7XG4gICAgICAgICAgY29uc3QgaWRWYWx1ZSA9IHJlY29yZC5pZCgpXG4gICAgICAgICAgY29uc3QgYWxsb3dlZCA9IGFsbG93ZWRJZHMuaGFzKG1vZGVsUHJpbWFyeUtleUNhY2hlS2V5KHByaW1hcnlLZXksIGlkVmFsdWUpKVxuICAgICAgICAgIHJlY29yZC5fc2V0Q29tcHV0ZWRBYmlsaXR5KGFjdGlvbiwgYWxsb3dlZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSB0aGUgZnJvbnRlbmQtbW9kZWwgYGFiaWxpdGllc2AgcGFyYW0gaW50byBhIGxpc3Qgb2ZcbiAgICogYHttb2RlbE5hbWUsIGFjdGlvbnN9YCBlbnRyaWVzIHRvIGV2YWx1YXRlIGFnYWluc3QgbG9hZGVkIHJlY29yZHMuXG4gICAqIFVua25vd24gZW50cmllcyBhcmUgc2lsZW50bHkgc2tpcHBlZCDigJQgZG93bnN0cmVhbSBjb2RlIHJlc29sdmVzXG4gICAqIG1vZGVsIG5hbWVzIHRvIGNsYXNzZXMgd2hlbiBhcHBseWluZyB0aGUgY2hlY2ssIHNvIHVucmVzb2x2ZWRcbiAgICogbmFtZXMgbmF0dXJhbGx5IGJlY29tZSBuby1vcHMuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7bW9kZWxOYW1lOiBzdHJpbmcsIGFjdGlvbnM6IHN0cmluZ1tdfT59IC0gTm9ybWFsaXplZCBtb2RlbCBhYmlsaXR5IHJlcXVlc3RzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEFiaWxpdGllcygpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5hYmlsaXRpZXNcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShyYXcpKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIEVudHJpZXMuXG4gICAgICogQHR5cGUge0FycmF5PHttb2RlbE5hbWU6IHN0cmluZywgYWN0aW9uczogc3RyaW5nW119Pn0gKi9cbiAgICBjb25zdCBlbnRyaWVzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmF3KSB7XG4gICAgICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIikgY29udGludWVcbiAgICAgIGlmICh0eXBlb2YgZW50cnkubW9kZWxOYW1lICE9PSBcInN0cmluZ1wiIHx8IGVudHJ5Lm1vZGVsTmFtZS5sZW5ndGggPT09IDApIGNvbnRpbnVlXG4gICAgICBpZiAoIUFycmF5LmlzQXJyYXkoZW50cnkuYWN0aW9ucykpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGFjdGlvbnMgPSBlbnRyeS5hY3Rpb25zLmZpbHRlcihcbiAgICAgICAgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIGFjdGlvbikgPT4gdHlwZW9mIGFjdGlvbiA9PT0gXCJzdHJpbmdcIiAmJiBhY3Rpb24ubGVuZ3RoID4gMFxuICAgICAgKVxuXG4gICAgICBpZiAoYWN0aW9ucy5sZW5ndGggPT09IDApIGNvbnRpbnVlXG5cbiAgICAgIGVudHJpZXMucHVzaCh7YWN0aW9ucywgbW9kZWxOYW1lOiBlbnRyeS5tb2RlbE5hbWV9KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzXG4gIH1cblxuICAvKipcbiAgICogUmVhZCB0aGUgZnJvbnRlbmQtbW9kZWwgYHF1ZXJ5RGF0YWAgcGFyYW0uIFRoZSB3aXJlIGZvcm1hdCBjYXJyaWVzXG4gICAqIG9ubHkgKipuYW1lcyoqICh0aGUga2V5cyB0aGUgZnJvbnRlbmQgd2FudHMgYXR0YWNoZWQpIHBsdXMgdGhlXG4gICAqIG9wdGlvbmFsIG5lc3RlZC1yZWxhdGlvbnNoaXAgY2hhaW4gbGVhZGluZyB0byB0aGVtIOKAlCB0aGUgYWN0dWFsIFNRTFxuICAgKiBmcmFnbWVudHMgbGl2ZSBvbiB0aGUgYmFja2VuZCBtb2RlbCBhcyBgTW9kZWwucXVlcnlEYXRhKG5hbWUsIGZuKWBcbiAgICogcmVnaXN0cmF0aW9ucy4gQ2FsbGVycyBjYW5ub3QgcHVzaCBTUUwgdGhyb3VnaCB0aGlzIGVuZHBvaW50LlxuICAgKlxuICAgKiBSZXR1cm5zIHRoZSByYXcgbmVzdGVkLXJlY29yZCBzcGVjIChzaGFwZSB2YWxpZGF0ZWQgYnkgdGhlXG4gICAqIG5vcm1hbGl6ZXIgaW5zaWRlIGBRdWVyeS5xdWVyeURhdGFgKSBvciBgbnVsbGAgd2hlbiBub3QgcmVxdWVzdGVkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YVNwZWMgfCBudWxsfSAtIE5vcm1hbGl6ZWQgcXVlcnktZGF0YSBzcGVjaWZpY2F0aW9uLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFF1ZXJ5RGF0YSgpIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKS5xdWVyeURhdGFcblxuICAgIGlmIChyYXcgPT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgIGlmICh0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiKSByZXR1cm4gcmF3XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkgcmV0dXJuIHJhd1xuICAgIGlmICh0eXBlb2YgcmF3ID09PSBcIm9iamVjdFwiKSByZXR1cm4gcmF3XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgaW5kZXggcXVlcnkuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEluZGV4UXVlcnlPcHRpb25zfSBbb3B0aW9uc10gLSBJbmRleCBxdWVyeSBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSAtIEZyb250ZW5kIGluZGV4IHF1ZXJ5IHdpdGggbm9ybWFsaXplZCBwYXJhbXMgYXBwbGllZC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxJbmRleFF1ZXJ5KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHtpbmNsdWRlUGFnaW5hdGlvbiA9IHRydWUsIGluY2x1ZGVTb3J0ID0gdHJ1ZSwgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKCl9ID0gb3B0aW9uc1xuICAgIGxldCBxdWVyeSA9IHRoaXMuZnJvbnRlbmRNb2RlbEF1dGhvcml6ZWRRdWVyeShcImluZGV4XCIpXG4gICAgY29uc3QgcHJlbG9hZCA9IHRoaXMuZnJvbnRlbmRNb2RlbFByZWxvYWQoKVxuXG4gICAgaWYgKHByZWxvYWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkucHJlbG9hZChwcmVsb2FkKVxuICAgIH1cblxuICAgIGNvbnN0IGpvaW5zID0gdGhpcy5mcm9udGVuZE1vZGVsSm9pbnMoKVxuICAgIGNvbnN0IHdoZXJlID0gdGhpcy5mcm9udGVuZE1vZGVsV2hlcmUoKVxuICAgIGNvbnN0IHBhZ2luYXRpb24gPSB0aGlzLmZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKClcbiAgICBjb25zdCBkaXN0aW5jdCA9IHRoaXMuZnJvbnRlbmRNb2RlbERpc3RpbmN0KClcblxuICAgIGlmIChpbmNsdWRlUGFnaW5hdGlvbikge1xuICAgICAgcmVzb3VyY2UuYXBwbHlGcm9udGVuZE1vZGVsSW5kZXhQYWdpbmF0aW9uKHtjb250cm9sbGVyOiB0aGlzLCBwYWdpbmF0aW9uLCBxdWVyeX0pXG4gICAgfVxuXG4gICAgaWYgKGRpc3RpbmN0ICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5kaXN0aW5jdChkaXN0aW5jdClcbiAgICB9XG5cbiAgICBpZiAod2hlcmUpIHtcbiAgICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmUoe3F1ZXJ5LCB3aGVyZX0pXG4gICAgfVxuXG4gICAgY29uc3QgcmFuc2FjayA9IHRoaXMuZnJvbnRlbmRNb2RlbFJhbnNhY2soKVxuXG4gICAgaWYgKHJhbnNhY2spIHtcbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBbGxvd2VkKHJhbnNhY2spXG4gICAgICBxdWVyeS5yYW5zYWNrKHJhbnNhY2spXG4gICAgfVxuXG4gICAgaWYgKGpvaW5zKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KVxuICAgIH1cblxuICAgIGNvbnN0IHNlYXJjaGVzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoZXMoKVxuXG4gICAgZm9yIChjb25zdCBzZWFyY2ggb2Ygc2VhcmNoZXMpIHtcbiAgICAgIHJlc291cmNlLmFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U2VhcmNoKHtjb250cm9sbGVyOiB0aGlzLCBxdWVyeSwgc2VhcmNofSlcbiAgICB9XG5cbiAgICBjb25zdCBncm91cHMgPSB0aGlzLmZyb250ZW5kTW9kZWxHcm91cCgpXG5cbiAgICBpZiAoZ3JvdXBzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsUm9vdEdyb3VwQ29sdW1ucyh7cXVlcnl9KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEdyb3VwKHtncm91cCwgcXVlcnl9KVxuICAgIH1cblxuICAgIGNvbnN0IHNvcnRzID0gdGhpcy5mcm9udGVuZE1vZGVsU29ydCgpXG5cbiAgICBpZiAoaW5jbHVkZVNvcnQgJiYgc29ydHMubGVuZ3RoID4gMCkge1xuICAgICAgZm9yIChjb25zdCBzb3J0IG9mIHNvcnRzKSB7XG4gICAgICAgIHJlc291cmNlLmFwcGx5RnJvbnRlbmRNb2RlbEluZGV4U29ydCh7Y29udHJvbGxlcjogdGhpcywgcXVlcnksIHNvcnR9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHdpdGhDb3VudCA9IHRoaXMuZnJvbnRlbmRNb2RlbFdpdGhDb3VudCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHdpdGhDb3VudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBTcGVjLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4gfCB7cmVsYXRpb25zaGlwPzogc3RyaW5nLCB3aGVyZT86IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSAqL1xuICAgICAgY29uc3Qgc3BlYyA9IHt9XG4gICAgICBzcGVjW2VudHJ5LmF0dHJpYnV0ZU5hbWVdID0ge3JlbGF0aW9uc2hpcDogZW50cnkucmVsYXRpb25zaGlwTmFtZSwgd2hlcmU6IGVudHJ5LndoZXJlfVxuICAgICAgcXVlcnkud2l0aENvdW50KHNwZWMpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnlEYXRhID0gdGhpcy5mcm9udGVuZE1vZGVsUXVlcnlEYXRhKClcblxuICAgIGlmIChxdWVyeURhdGEgIT0gbnVsbCkge1xuICAgICAgcXVlcnkucXVlcnlEYXRhKHF1ZXJ5RGF0YSlcbiAgICB9XG5cbiAgICBxdWVyeSA9IHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsVHJhbnNsYXRlZEF0dHJpYnV0ZVByZWxvYWRzKHtxdWVyeX0pXG5cbiAgICBpZiAocXVlcnkuX2Rpc3RpbmN0ICYmIHF1ZXJ5LmRyaXZlci5nZXRUeXBlKCkgPT09IFwibXNzcWxcIikge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbE1zc3FsRGlzdGluY3RCeVByaW1hcnlLZXlRdWVyeSh7cXVlcnl9KVxuICAgIH1cblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIE1TU1FMIGNhbm5vdCBhcHBseSBESVNUSU5DVCBvdmVyIG5vbi1jb21wYXJhYmxlIHRleHQgY29sdW1ucyBpbiB0YWJsZS4qIHNlbGVjdHMuXG4gICAqIFRoaXMgcmV3cml0ZXMgZGlzdGluY3QgZnJvbnRlbmQtbW9kZWwgcXVlcmllcyB0byBzZWxlY3Qgcm9vdCByZWNvcmRzIGJ5IGRpc3RpbmN0IFBLIHN1YnF1ZXJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgd2l0aCBkaXN0aW5jdCBhbmQgZmlsdGVycy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gLSBNU1NRTC1zYWZlIGRpc3RpbmN0IHF1ZXJ5LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbE1zc3FsRGlzdGluY3RCeVByaW1hcnlLZXlRdWVyeSh7cXVlcnl9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBcIk1TU1FMIGRpc3RpbmN0IGZyb250ZW5kLW1vZGVsIHF1ZXJpZXNcIilcbiAgICBjb25zdCByb290VGFibGVTcWwgPSBxdWVyeS5kcml2ZXIucXVvdGVUYWJsZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICAgIGNvbnN0IHByaW1hcnlLZXlTcWwgPSBgJHtyb290VGFibGVTcWx9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpfWBcbiAgICBjb25zdCBkaXN0aW5jdElkc1F1ZXJ5ID0gcXVlcnkuY2xvbmUoKVxuXG4gICAgZGlzdGluY3RJZHNRdWVyeS5fcHJlbG9hZCA9IHt9XG4gICAgZGlzdGluY3RJZHNRdWVyeS5fc2VsZWN0cyA9IFtdXG4gICAgZGlzdGluY3RJZHNRdWVyeS5zZWxlY3QocHJpbWFyeUtleVNxbClcbiAgICBkaXN0aW5jdElkc1F1ZXJ5LmRpc3RpbmN0KHRydWUpXG5cbiAgICBjb25zdCBkaXN0aW5jdFJvb3RRdWVyeSA9IG1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcblxuICAgIGRpc3RpbmN0Um9vdFF1ZXJ5LndoZXJlKGAke3ByaW1hcnlLZXlTcWx9IElOICgke2Rpc3RpbmN0SWRzUXVlcnkudG9TcWwoKX0pYClcbiAgICBkaXN0aW5jdFJvb3RRdWVyeS5fcHJlbG9hZCA9IHsuLi5xdWVyeS5fcHJlbG9hZH1cblxuICAgIHJldHVybiBkaXN0aW5jdFJvb3RRdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcGx1Y2sgdmFsdWVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBsdWNrIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFBsdWNrW119IGFyZ3MucGx1Y2sgLSBQbHVjayBkZXNjcmlwdG9ycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQbHVja2VkIHZhbHVlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxQbHVja1ZhbHVlcyh7cXVlcnksIHBsdWNrfSkge1xuICAgIGlmIChwbHVjay5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBjb2x1bW5zIGdpdmVuIHRvIHBsdWNrXCIpXG4gICAgfVxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBwbHVja1F1ZXJ5ID0gcXVlcnkuY2xvbmUoKVxuICAgIC8qKlxuICAgICAqIEFsaWFzZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGFsaWFzZXMgPSBbXVxuICAgIGNvbnN0IHF1ZXJ5TWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShxdWVyeSlcbiAgICBjb25zdCBwbHVja1F1ZXJ5TWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsUXVlcnlNZXRhZGF0YShwbHVja1F1ZXJ5KVxuICAgIGNvbnN0IGpvaW5lZFBhdGhzID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdXG5cbiAgICBwbHVja1F1ZXJ5Ll9wcmVsb2FkID0ge31cbiAgICBwbHVja1F1ZXJ5Ll9zZWxlY3RzID0gW11cbiAgICBwbHVja1F1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXSA9IGpvaW5lZFBhdGhzID8gbmV3IFNldChqb2luZWRQYXRocykgOiBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgW3BsdWNrSW5kZXgsIHBsdWNrRW50cnldIG9mIHBsdWNrLmVudHJpZXMoKSkge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBwYXRoOiBwbHVja0VudHJ5LnBhdGhcbiAgICAgIH0pXG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgICBhdHRyaWJ1dGVOYW1lOiBwbHVja0VudHJ5LmNvbHVtbixcbiAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgICAgb3BlcmF0aW9uTmFtZTogXCJwbHVja1wiXG4gICAgICB9KVxuXG4gICAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gcGx1Y2sgY29sdW1uIFwiJHtwbHVja0VudHJ5LmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHBsdWNrRW50cnkucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEpvaW5QYXRoKHtwYXRoOiBwbHVja0VudHJ5LnBhdGgsIHF1ZXJ5OiBwbHVja1F1ZXJ5fSlcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFibGVSZWZlcmVuY2UgPSBwbHVja1F1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wbHVja0VudHJ5LnBhdGgpXG4gICAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtwbHVja1F1ZXJ5LmRyaXZlci5xdW90ZVRhYmxlKHRhYmxlUmVmZXJlbmNlKX0uJHtwbHVja1F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG4gICAgICBjb25zdCBhbGlhcyA9IGBmcm9udGVuZF9tb2RlbF9wbHVja18ke3BsdWNrSW5kZXh9YFxuXG4gICAgICBwbHVja1F1ZXJ5LnNlbGVjdChgJHtjb2x1bW5TcWx9IEFTICR7cGx1Y2tRdWVyeS5kcml2ZXIucXVvdGVDb2x1bW4oYWxpYXMpfWApXG4gICAgICBhbGlhc2VzLnB1c2goYWxpYXMpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHBsdWNrUXVlcnkucmVzdWx0cygpXG5cbiAgICBpZiAoYWxpYXNlcy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IFthbGlhc10gPSBhbGlhc2VzXG5cbiAgICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJvdylbYWxpYXNdKVxuICAgIH1cblxuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBjb25zdCByb3dIYXNoID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyb3cpXG5cbiAgICAgIHJldHVybiBhbGlhc2VzLm1hcCgoYWxpYXMpID0+IHJvd0hhc2hbYWxpYXNdKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBmcm9udGVuZC1tb2RlbCBwbHVjayBhdHRyaWJ1dGUgdG8gYSBkYXRhYmFzZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7e2F0dHJpYnV0ZU5hbWU6IHN0cmluZywgbW9kZWxDbGFzczogdHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSBSZXNvbHZlZCBEQiBjb2x1bW4gbmFtZS5cbiAgICovXG4gIHJlc29sdmVGcm9udGVuZE1vZGVsUGx1Y2tDb2x1bW5OYW1lKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVOYW1lc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lcyAmJiAhYXR0cmlidXRlTmFtZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbENvbHVtbk5hbWUobW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cG9zZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzIGZvciBhIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPiB8IG51bGx9IEV4cG9zZWQgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLCBvciBudWxsIHdoZW4gdGhlIHJlc291cmNlIGV4cG9zZXMgYWxsIERCLWJhY2tlZCBtb2RlbCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBmcm9udGVuZE1vZGVsUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuIG5ldyBTZXQoKVxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlc1xuXG4gICAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUF0dHJpYnV0ZU5hbWVzKGF0dHJpYnV0ZXMpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZXMuc2l6ZSA8IDEpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXR0cmlidXRlTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4cG9zZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uW1wiYXR0cmlidXRlc1wiXX0gYXR0cmlidXRlcyAtIFJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gRXhwb3NlZCByZXNvdXJjZSBhdHRyaWJ1dGUgbmFtZXMuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsUmVzb3VyY2VBdHRyaWJ1dGVOYW1lcyhhdHRyaWJ1dGVzKSB7XG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IG5ldyBTZXQoKVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICBhdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhdHRyaWJ1dGVDb25maWcgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsQXR0cmlidXRlQ29uZmlndXJhdGlvbn0gKi8gKGF0dHJpYnV0ZSlcblxuICAgICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZUNvbmZpZy5uYW1lICE9PSBcInN0cmluZ1wiIHx8IGF0dHJpYnV0ZUNvbmZpZy5uYW1lLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJGcm9udGVuZC1tb2RlbCByZXNvdXJjZSBhdHRyaWJ1dGUgYXJyYXkgZW50cmllcyBtdXN0IGJlIHN0cmluZ3Mgb3IgY29uZmlncyB3aXRoIGEgbmFtZS5cIilcbiAgICAgICAgfVxuXG4gICAgICAgIGF0dHJpYnV0ZU5hbWVzLmFkZChhdHRyaWJ1dGVDb25maWcubmFtZSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGF0dHJpYnV0ZU5hbWVzXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoT2JqZWN0LmtleXMoYXR0cmlidXRlcykpXG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBmcm9udGVuZC1tb2RlbCBwbHVjayBkZWZpbml0aW9ucyBvbmx5IHJlZmVyZW5jZSBleHBvc2VkIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFBsdWNrW119IHBsdWNrIC0gUGx1Y2sgZGVzY3JpcHRvcnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFBsdWNrRGVmaW5pdGlvbnNBbGxvd2VkKHBsdWNrKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcblxuICAgIGZvciAoY29uc3QgcGx1Y2tFbnRyeSBvZiBwbHVjaykge1xuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICBwYXRoOiBwbHVja0VudHJ5LnBhdGhcbiAgICAgIH0pXG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFBsdWNrQ29sdW1uTmFtZSh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHBsdWNrRW50cnkuY29sdW1uLFxuICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzXG4gICAgICB9KVxuXG4gICAgICBpZiAoIWNvbHVtbk5hbWUpIHtcbiAgICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gcGx1Y2sgY29sdW1uIFwiJHtwbHVja0VudHJ5LmNvbHVtbn1cIiBmb3IgJHt0YXJnZXRNb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBmcm9udGVuZC1tb2RlbCBSYW5zYWNrIGRlZmluaXRpb25zIG9ubHkgcmVmZXJlbmNlIGV4cG9zZWQgcmVzb3VyY2UgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJhbnNhY2sgLSBSYW5zYWNrIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tBbGxvd2VkKHJhbnNhY2spIHtcbiAgICBjb25zdCB7cywgLi4uZmlsdGVyUGFyYW1zfSA9IHJhbnNhY2tcblxuICAgIGlmIChPYmplY3Qua2V5cyhmaWx0ZXJQYXJhbXMpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cEFsbG93ZWQoe1xuICAgICAgICBncm91cDogdGhpcy5mcm9udGVuZE1vZGVsUmFuc2Fja0dyb3VwKGZpbHRlclBhcmFtcylcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBzID09PSBcInN0cmluZ1wiICYmIHMudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAoY29uc3Qgc29ydCBvZiB0aGlzLmZyb250ZW5kTW9kZWxSYW5zYWNrU29ydHMocykpIHtcbiAgICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0F0dHJpYnV0ZUFsbG93ZWQoe1xuICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IHNvcnQuYXR0cmlidXRlLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZTogXCJyYW5zYWNrIHNvcnRcIlxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBncm91cC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGZpbHRlclBhcmFtcyAtIFJhbnNhY2sgZmlsdGVyIHBhcmFtcy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdXRpbHMvcmFuc2Fjay5qc1wiKS5SYW5zYWNrR3JvdXB9IE5vcm1hbGl6ZWQgUmFuc2FjayBncm91cC5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSYW5zYWNrR3JvdXAoZmlsdGVyUGFyYW1zKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBub3JtYWxpemVSYW5zYWNrR3JvdXAodGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKSwgZmlsdGVyUGFyYW1zKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZWQgZnJvbnRlbmQtbW9kZWwgUmFuc2FjayBzb3J0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNvcnRTdHJpbmcgLSBSYW5zYWNrIHNvcnQgc3RyaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tTb3J0W119IE5vcm1hbGl6ZWQgUmFuc2FjayBzb3J0cy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxSYW5zYWNrU29ydHMoc29ydFN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gcGFyc2VSYW5zYWNrU29ydCh0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLCBzb3J0U3RyaW5nKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gdGhyb3dGcm9udGVuZE1vZGVsUXVlcnlFcnJvckZvclBhcnNlckVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnRzIGEgbm9ybWFsaXplZCBmcm9udGVuZC1tb2RlbCBSYW5zYWNrIGdyb3VwIG9ubHkgcmVmZXJlbmNlcyBleHBvc2VkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXNzZXJ0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi91dGlscy9yYW5zYWNrLmpzXCIpLlJhbnNhY2tHcm91cH0gYXJncy5ncm91cCAtIFJhbnNhY2sgZ3JvdXAuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFJhbnNhY2tHcm91cEFsbG93ZWQoe2dyb3VwfSkge1xuICAgIGZvciAoY29uc3QgY29uZGl0aW9uIG9mIGdyb3VwLmNvbmRpdGlvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlIG9mIGNvbmRpdGlvbi5hdHRyaWJ1dGVzKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgICAgICBtb2RlbENsYXNzOiB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpLFxuICAgICAgICAgIHBhdGg6IGF0dHJpYnV0ZS5wYXRoXG4gICAgICAgIH0pXG5cbiAgICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0F0dHJpYnV0ZUFsbG93ZWQoe1xuICAgICAgICAgIGF0dHJpYnV0ZU5hbWU6IGF0dHJpYnV0ZS5hdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgICAgb3BlcmF0aW9uTmFtZTogXCJyYW5zYWNrXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGdyb3VwaW5nIG9mIGdyb3VwLmdyb3VwaW5ncykge1xuICAgICAgdGhpcy5hc3NlcnRGcm9udGVuZE1vZGVsUmFuc2Fja0dyb3VwQWxsb3dlZCh7Z3JvdXA6IGdyb3VwaW5nfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXNzZXJ0cyBvbmUgbm9ybWFsaXplZCBmcm9udGVuZC1tb2RlbCBSYW5zYWNrIGF0dHJpYnV0ZSBpcyBleHBvc2VkIGJ5IGl0cyByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBc3NlcnRpb24gYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm9wZXJhdGlvbk5hbWUgLSBPcGVyYXRpb24gbmFtZSBmb3IgZXJyb3JzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2VydEZyb250ZW5kTW9kZWxSYW5zYWNrQXR0cmlidXRlQWxsb3dlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgb3BlcmF0aW9uTmFtZX0pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQXR0cmlidXRlTmFtZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZXMgJiYgIWF0dHJpYnV0ZU5hbWVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gJHtvcGVyYXRpb25OYW1lfSBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgc2VhcmNoIHRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUm9vdCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIHBhdGguXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gLSBUYXJnZXQgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7bW9kZWxDbGFzcywgcGF0aH0pIHtcbiAgICBsZXQgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBvZiBwYXRoKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0YXJnZXRNb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBzZWFyY2ggcmVsYXRpb25zaGlwIFwiJHtyZWxhdGlvbnNoaXBOYW1lfVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfSMke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICAgIH1cblxuICAgICAgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcFRhcmdldE1vZGVsQ2xhc3NcbiAgICB9XG5cbiAgICByZXR1cm4gdGFyZ2V0TW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgc2VhcmNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFNlYXJjaCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxTZWFyY2h9IGFyZ3Muc2VhcmNoIC0gU2VhcmNoIGZpbHRlci5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxTZWFyY2goe3F1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VhcmNoVGFyZ2V0TW9kZWxDbGFzcyh7XG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgcGF0aDogc2VhcmNoLnBhdGhcbiAgICB9KVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLnJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7XG4gICAgICBhdHRyaWJ1dGVOYW1lOiBzZWFyY2guY29sdW1uLFxuICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgIG9wZXJhdGlvbk5hbWU6IFwic2VhcmNoXCJcbiAgICB9KVxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBzZWFyY2ggY29sdW1uIFwiJHtzZWFyY2guY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChzZWFyY2gucGF0aC5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aDogc2VhcmNoLnBhdGgsIHF1ZXJ5fSlcbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5zZWFyY2gucGF0aClcbiAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcbiAgICBjb25zdCBvcGVyYXRvck1hcCA9IHtcbiAgICAgIGVxOiBcIj1cIixcbiAgICAgIGd0OiBcIj5cIixcbiAgICAgIGd0ZXE6IFwiPj1cIixcbiAgICAgIGxpa2U6IFwiTElLRVwiLFxuICAgICAgbHQ6IFwiPFwiLFxuICAgICAgbHRlcTogXCI8PVwiLFxuICAgICAgbm90RXE6IFwiIT1cIlxuICAgIH1cbiAgICBjb25zdCBzcWxPcGVyYXRvciA9IG9wZXJhdG9yTWFwW3NlYXJjaC5vcGVyYXRvcl1cblxuICAgIGlmIChzZWFyY2gub3BlcmF0b3IgPT09IFwiZXFcIikge1xuICAgICAgaWYgKHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsQXJyYXlTZWFyY2goe2VtcHR5U3FsOiBcIjE9MFwiLCBvcGVyYXRvclNxbDogXCJJTlwiLCBxdWVyeSwgc2VhcmNoLCBjb2x1bW5TcWx9KSkgcmV0dXJuXG5cbiAgICAgIGlmIChzZWFyY2gudmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSBJUyBOVUxMYClcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNlYXJjaC5vcGVyYXRvciA9PT0gXCJub3RFcVwiKSB7XG4gICAgICBpZiAodGhpcy5hcHBseUZyb250ZW5kTW9kZWxBcnJheVNlYXJjaCh7ZW1wdHlTcWw6IFwiMT0xXCIsIG9wZXJhdG9yU3FsOiBcIk5PVCBJTlwiLCBxdWVyeSwgc2VhcmNoLCBjb2x1bW5TcWx9KSkgcmV0dXJuXG5cbiAgICAgIGlmIChzZWFyY2gudmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSBJUyBOT1QgTlVMTGApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgIH1cblxuICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gJHtzcWxPcGVyYXRvcn0gJHtxdWVyeS5kcml2ZXIucXVvdGUoc2VhcmNoLnZhbHVlKX1gKVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGx5IGFycmF5LXZhbHVlZCBlcXVhbGl0eSBzZWFyY2ggZmlsdGVycy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZWFyY2ggYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5TcWwgLSBTUUwgZm9yIHRoZSBzZWFyY2hlZCBjb2x1bW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmVtcHR5U3FsIC0gU1FMIHByZWRpY2F0ZSB1c2VkIHdoZW4gdGhlIGFycmF5IGlzIGVtcHR5LlxuICAgKiBAcGFyYW0ge1wiSU5cIiB8IFwiTk9UIElOXCJ9IGFyZ3Mub3BlcmF0b3JTcWwgLSBTUUwgYXJyYXkgb3BlcmF0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFNlYXJjaH0gYXJncy5zZWFyY2ggLSBTZWFyY2ggZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbiBhcnJheSBwcmVkaWNhdGUgd2FzIGFwcGxpZWQuXG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxBcnJheVNlYXJjaCh7Y29sdW1uU3FsLCBlbXB0eVNxbCwgb3BlcmF0b3JTcWwsIHF1ZXJ5LCBzZWFyY2h9KSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNlYXJjaC52YWx1ZSkpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKHNlYXJjaC52YWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgIHF1ZXJ5LndoZXJlKGVtcHR5U3FsKVxuICAgIH0gZWxzZSB7XG4gICAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9ICR7b3BlcmF0b3JTcWx9ICgke3NlYXJjaC52YWx1ZS5tYXAoKGVudHJ5KSA9PiBxdWVyeS5kcml2ZXIucXVvdGUoZW50cnkpKS5qb2luKFwiLCBcIil9KWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHBhZ2luYXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnaW5hdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0Zyb250ZW5kTW9kZWxQYWdpbmF0aW9ufSBhcmdzLnBhZ2luYXRpb24gLSBQYWdpbmF0aW9uIHZhbHVlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxQYWdpbmF0aW9uKHtxdWVyeSwgcGFnaW5hdGlvbn0pIHtcbiAgICBpZiAocGFnaW5hdGlvbi5saW1pdCAhPT0gbnVsbCkge1xuICAgICAgcXVlcnkubGltaXQocGFnaW5hdGlvbi5saW1pdClcbiAgICB9XG5cbiAgICBpZiAocGFnaW5hdGlvbi5vZmZzZXQgIT09IG51bGwpIHtcbiAgICAgIHF1ZXJ5Lm9mZnNldChwYWdpbmF0aW9uLm9mZnNldClcbiAgICB9XG5cbiAgICBpZiAocGFnaW5hdGlvbi5wZXJQYWdlICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5wZXJQYWdlKHBhZ2luYXRpb24ucGVyUGFnZSlcbiAgICB9XG5cbiAgICBpZiAocGFnaW5hdGlvbi5wYWdlICE9PSBudWxsKSB7XG4gICAgICBxdWVyeS5wYWdlKHBhZ2luYXRpb24ucGFnZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBseSBmcm9udGVuZCBtb2RlbCB3aGVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBXaGVyZSBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy53aGVyZSAtIFJvb3QtbW9kZWwgd2hlcmUgY29uZGl0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxXaGVyZSh7cXVlcnksIHdoZXJlfSkge1xuICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmVGb3JQYXRoKHtcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICBwYXRoOiBbXSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgd2hlcmVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgam9pbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbnMgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muam9pbnMgLSBSZWxhdGlvbnNoaXAtb2JqZWN0IGpvaW5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zKHtqb2lucywgcXVlcnl9KSB7XG4gICAgY29uc3Qgam9pblBhdGhLZXlzID0gbmV3IFNldCgpXG5cbiAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zRm9yUGF0aCh7XG4gICAgICBqb2lucyxcbiAgICAgIGpvaW5QYXRoS2V5cyxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKCksXG4gICAgICBwYXRoOiBbXSxcbiAgICAgIHF1ZXJ5XG4gICAgfSlcblxuICAgIHF1ZXJ5LmpvaW5zKGpvaW5zKVxuXG4gICAgY29uc3QgcXVlcnlNZXRhZGF0YSA9IGZyb250ZW5kTW9kZWxRdWVyeU1ldGFkYXRhKHF1ZXJ5KVxuICAgIGNvbnN0IGpvaW5lZFBhdGhzID0gcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsSm9pbmVkUGF0aHNTeW1ib2xdIHx8IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBqb2luUGF0aEtleSBvZiBqb2luUGF0aEtleXMpIHtcbiAgICAgIGpvaW5lZFBhdGhzLmFkZChqb2luUGF0aEtleSlcbiAgICB9XG5cbiAgICBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gPSBqb2luZWRQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgam9pbnMgZm9yIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbnMgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muam9pbnMgLSBKb2lucyBmb3IgY3VycmVudCBwYXRoLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBhcmdzLmpvaW5QYXRoS2V5cyAtIEpvaW5lZCBwYXRoIGtleXMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIGZvciBjdXJyZW50IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zRm9yUGF0aCh7am9pbnMsIGpvaW5QYXRoS2V5cywgbW9kZWxDbGFzcywgcGF0aCwgcXVlcnl9KSB7XG4gICAgdm9pZCBxdWVyeVxuXG4gICAgZm9yIChjb25zdCBbcmVsYXRpb25zaGlwTmFtZSwgcmVsYXRpb25zaGlwSm9pbl0gb2YgT2JqZWN0LmVudHJpZXMoam9pbnMpKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBqb2luIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gdGFyZ2V0IG1vZGVsIGNsYXNzIGZvciBqb2luIHJlbGF0aW9uc2hpcCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBvbiAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBQYXRoID0gWy4uLnBhdGgsIHJlbGF0aW9uc2hpcE5hbWVdXG4gICAgICBqb2luUGF0aEtleXMuYWRkKHJlbGF0aW9uc2hpcFBhdGguam9pbihcIi5cIikpXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBKb2luID09PSB0cnVlKSBjb250aW51ZVxuXG4gICAgICB0aGlzLmFwcGx5RnJvbnRlbmRNb2RlbEpvaW5zRm9yUGF0aCh7XG4gICAgICAgIGpvaW5zOiByZWxhdGlvbnNoaXBKb2luLFxuICAgICAgICBqb2luUGF0aEtleXMsXG4gICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgIHBhdGg6IHJlbGF0aW9uc2hpcFBhdGgsXG4gICAgICAgIHF1ZXJ5XG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGV4cG9zZWQgYXR0cmlidXRlIG5hbWVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz4gfCBudWxsfSAtIEV4cG9zZWQgYXR0cmlidXRlIG5hbWVzLCBvciBudWxsIHdoZW4gbm8gcmVzb3VyY2UgbWV0YWRhdGEgaXMgYXZhaWxhYmxlLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEV4cG9zZWRBdHRyaWJ1dGVOYW1lc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlPy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlc1xuXG4gICAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gYXR0cmlidXRlc1xuICAgICAgICAubWFwKChlbnRyeSkgPT4ge1xuICAgICAgICAgIGlmICh0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIpIHJldHVybiBlbnRyeVxuICAgICAgICAgIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbFxuXG4gICAgICAgICAgY29uc3QgbmFtZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpLm5hbWVcblxuICAgICAgICAgIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLmxlbmd0aCA+IDAgPyBuYW1lIDogbnVsbFxuICAgICAgICB9KVxuICAgICAgICAuZmlsdGVyKChlbnRyeSkgPT4gdHlwZW9mIGVudHJ5ID09PSBcInN0cmluZ1wiKVxuXG4gICAgICBpZiAoYXR0cmlidXRlTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbFxuXG4gICAgICByZXR1cm4gbmV3IFNldChhdHRyaWJ1dGVOYW1lcylcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBuZXcgU2V0KE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKVxuICAgIH1cblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBmcm9udGVuZC1zdXBwbGllZCBrZXkgdG8gaXRzIGNhbm9uaWNhbCBtb2RlbCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gRnJvbnRlbmQga2V5IG9yIHJhdyBjb2x1bW4ga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBDYW5vbmljYWwgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQXR0cmlidXRlTmFtZUZvcktleShtb2RlbENsYXNzLCBrZXkpIHtcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGtleSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiByZXNvbHZlZEF0dHJpYnV0ZU5hbWVcblxuICAgIGNvbnN0IGNvbHVtbkF0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtrZXldXG5cbiAgICByZXR1cm4gY29sdW1uQXR0cmlidXRlTmFtZSB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZnJvbnRlbmQtc3VwcGxpZWQgYXR0cmlidXRlIGlzIGV4cG9zZWQgYnkgdGhlIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF0dHJpYnV0ZU5hbWUgLSBSZXF1ZXN0ZWQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBwZXJtaXRzIHRoZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsQXR0cmlidXRlSXNFeHBvc2VkKHthdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkge1xuICAgIGNvbnN0IGV4cG9zZWRBdHRyaWJ1dGVOYW1lcyA9IHRoaXMuZnJvbnRlbmRNb2RlbEV4cG9zZWRBdHRyaWJ1dGVOYW1lc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIGlmICghZXhwb3NlZEF0dHJpYnV0ZU5hbWVzKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGV4cG9zZWRBdHRyaWJ1dGVOYW1lcy5oYXMoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnRzIGEgc2VsZWN0ZWQgZnJvbnRlbmQtbW9kZWwgYXR0cmlidXRlIGxpc3Qgb25seSByZWZlcmVuY2VzIGV4cG9zZWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmF0dHJpYnV0ZU5hbWVzIC0gU2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtcInNlbGVjdFwiIHwgXCJzZWxlY3RzRXh0cmFcIn0gYXJncy5vcGVyYXRpb25OYW1lIC0gU2VsZWN0aW9uIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIEFsbG93ZWQgc2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzLlxuICAgKi9cbiAgYXNzZXJ0RnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0FsbG93ZWQoe2F0dHJpYnV0ZU5hbWVzLCBtb2RlbENsYXNzLCBvcGVyYXRpb25OYW1lfSkge1xuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhdHRyaWJ1dGVOYW1lcykge1xuICAgICAgaWYgKHRoaXMuZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUlzRXhwb3NlZCh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzc30pKSBjb250aW51ZVxuXG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biAke29wZXJhdGlvbk5hbWV9IGF0dHJpYnV0ZSBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlTmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHVzZXItcXVlcnlhYmxlIGZyb250ZW5kIGF0dHJpYnV0ZSB0byBhIGRhdGFiYXNlIGNvbHVtbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gUmVxdWVzdGVkIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtcImdyb3VwXCIgfCBcInBsdWNrXCIgfCBcInNlYXJjaFwiIHwgXCJzb3J0XCIgfCBcIndoZXJlXCJ9IGFyZ3Mub3BlcmF0aW9uTmFtZSAtIFF1ZXJ5IG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXNvbHZlZCBjb2x1bW4gbmFtZS5cbiAgICovXG4gIHJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7YXR0cmlidXRlTmFtZSwgbW9kZWxDbGFzcywgb3BlcmF0aW9uTmFtZX0pIHtcbiAgICB2b2lkIG9wZXJhdGlvbk5hbWVcblxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMuZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZU5hbWVGb3JLZXkobW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUgJiYgIXRoaXMuZnJvbnRlbmRNb2RlbEF0dHJpYnV0ZUlzRXhwb3NlZCh7YXR0cmlidXRlTmFtZTogcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lLCBtb2RlbENsYXNzfSkpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbENvbHVtbk5hbWUobW9kZWxDbGFzcywgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGtleSB0aGF0IG1heSBiZSBlaXRoZXIgYSBjYW1lbENhc2UgYXR0cmlidXRlIG5hbWUgb3IgYSByYXcgREJcbiAgICogY29sdW1uIG5hbWUgdG8gaXRzIGNhbm9uaWNhbCBjb2x1bW4gbmFtZS4gIFJldHVybnMgYHVuZGVmaW5lZGAgd2hlbiB0aGVcbiAgICoga2V5IG1hdGNoZXMgbmVpdGhlciBtYXAuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIEF0dHJpYnV0ZSBuYW1lIG9yIGNvbHVtbiBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVzb2x2ZWQgREIgY29sdW1uIG5hbWUsIG9yIGB1bmRlZmluZWRgLlxuICAgKi9cbiAgcmVzb2x2ZUZyb250ZW5kTW9kZWxDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGtleSkge1xuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IG1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoa2V5KVxuXG4gICAgaWYgKHJlc29sdmVkQXR0cmlidXRlTmFtZSkgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW3Jlc29sdmVkQXR0cmlidXRlTmFtZV1cblxuICAgIC8vIEZhbGwgYmFjazogdGhlIGtleSBtYXkgYWxyZWFkeSBiZSBhIHJhdyBEQiBjb2x1bW4gbmFtZSBub3QgcHJlc2VudCBpbiB0aGUgYXR0cmlidXRlIG1hcC5cbiAgICBpZiAobW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClba2V5XSkgcmV0dXJuIGtleVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgd2hlcmUgZm9yIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gV2hlcmUgYXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgZm9yIGN1cnJlbnQgd2hlcmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MucGF0aCAtIFJlbGF0aW9uc2hpcCBwYXRoIGZyb20gcm9vdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Mud2hlcmUgLSBXaGVyZSBjb25kaXRpb25zIGZvciBjdXJyZW50IHNjb3BlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFdoZXJlRm9yUGF0aCh7bW9kZWxDbGFzcywgcGF0aCwgcXVlcnksIHdoZXJlfSkge1xuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh3aGVyZSkpIHtcbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLnJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIG9wZXJhdGlvbk5hbWU6IFwid2hlcmVcIlxuICAgICAgfSlcblxuICAgICAgaWYgKGNvbHVtbk5hbWUpIHtcbiAgICAgICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGgsIHF1ZXJ5fSlcblxuICAgICAgICBjb25zdCB0YWJsZVJlZmVyZW5jZSA9IHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5wYXRoKVxuICAgICAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICBpZiAodmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBxdWVyeS53aGVyZShcIjE9MFwiKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkVmFsdWVzID0gdmFsdWUubWFwKChlbnRyeSkgPT4gdGhpcy5ub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmVDb2x1bW5WYWx1ZSh7Y29sdW1uTmFtZSwgbW9kZWxDbGFzcywgdmFsdWU6IGVudHJ5fSkpXG5cbiAgICAgICAgICAgIGlmIChub3JtYWxpemVkVmFsdWVzLmluY2x1ZGVzKGZyb250ZW5kTW9kZWxXaGVyZU5vTWF0Y2hTeW1ib2wpKSB7XG4gICAgICAgICAgICAgIHF1ZXJ5LndoZXJlKFwiMT0wXCIpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBxdWVyeS53aGVyZShgJHtjb2x1bW5TcWx9IElOICgke25vcm1hbGl6ZWRWYWx1ZXMubWFwKChlbnRyeSkgPT4gcXVlcnkuZHJpdmVyLnF1b3RlKGVudHJ5KSkuam9pbihcIiwgXCIpfSlgKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmFsdWUgPT0gbnVsbCkge1xuICAgICAgICAgIHF1ZXJ5LndoZXJlKGAke2NvbHVtblNxbH0gSVMgTlVMTGApXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5ub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmVDb2x1bW5WYWx1ZSh7Y29sdW1uTmFtZSwgbW9kZWxDbGFzcywgdmFsdWV9KVxuXG4gICAgICAgICAgaWYgKG5vcm1hbGl6ZWRWYWx1ZSA9PT0gZnJvbnRlbmRNb2RlbFdoZXJlTm9NYXRjaFN5bWJvbCkge1xuICAgICAgICAgICAgcXVlcnkud2hlcmUoXCIxPTBcIilcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcXVlcnkud2hlcmUoYCR7Y29sdW1uU3FsfSA9ICR7cXVlcnkuZHJpdmVyLnF1b3RlKG5vcm1hbGl6ZWRWYWx1ZSl9YClcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbYXR0cmlidXRlTmFtZV1cblxuICAgICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHdoZXJlIHJlbGF0aW9uc2hpcCBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgaWYgKCF0YXJnZXRNb2RlbENsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0YXJnZXQgbW9kZWwgY2xhc3MgZm9yIHdoZXJlIHJlbGF0aW9uc2hpcCBcIiR7YXR0cmlidXRlTmFtZX1cIiBvbiAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwUGF0aCA9IFsuLi5wYXRoLCBhdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIHRoaXMuYXBwbHlGcm9udGVuZE1vZGVsV2hlcmVGb3JQYXRoKHtcbiAgICAgICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgICAgIHBhdGg6IHJlbGF0aW9uc2hpcFBhdGgsXG4gICAgICAgICAgcXVlcnksXG4gICAgICAgICAgd2hlcmU6IHZhbHVlXG4gICAgICAgIH0pXG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gd2hlcmUgY29sdW1uIFwiJHthdHRyaWJ1dGVOYW1lfVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBmcm9udGVuZCBtb2RlbCB3aGVyZSBjb2x1bW4gdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFdoZXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCBzeW1ib2x9IC0gU1FMLXNhZmUgd2hlcmUgdmFsdWUuXG4gICAqL1xuICBub3JtYWxpemVGcm9udGVuZE1vZGVsV2hlcmVDb2x1bW5WYWx1ZSh7Y29sdW1uTmFtZSwgbW9kZWxDbGFzcywgdmFsdWV9KSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKT8udG9Mb3dlckNhc2UoKVxuICAgICAgY29uc3QgaXNEYXRlVGltZUNvbHVtbiA9IHR5cGVvZiBjb2x1bW5UeXBlID09PSBcInN0cmluZ1wiICYmIFtcImRhdGVcIiwgXCJkYXRldGltZVwiLCBcInRpbWVzdGFtcFwiXS5zb21lKCh0eXBlKSA9PiBjb2x1bW5UeXBlLmluY2x1ZGVzKHR5cGUpKVxuXG4gICAgICBpZiAoaXNEYXRlVGltZUNvbHVtbikge1xuICAgICAgICBjb25zdCBwYXJzZWREYXRlID0gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKX0pXG5cbiAgICAgICAgaWYgKGlzRGF0ZShwYXJzZWREYXRlKSkge1xuICAgICAgICAgIHJldHVybiBwYXJzZWREYXRlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgICAgaWYgKHR5cGVvZiBjb2x1bW5UeXBlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpXG4gICAgICBjb25zdCBvYmplY3RWYWx1ZVR5cGVzID0gbmV3IFNldChbXCJjaGFyXCIsIFwidmFyY2hhclwiLCBcIm52YXJjaGFyXCIsIFwic3RyaW5nXCIsIFwiZW51bVwiLCBcImpzb25cIiwgXCJqc29uYlwiLCBcImNpdGV4dFwiLCBcImJpbmFyeVwiLCBcInZhcmJpbmFyeVwiXSlcbiAgICAgIGNvbnN0IHN1cHBvcnRzT2JqZWN0VmFsdWVzID0gbm9ybWFsaXplZFR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8IG9iamVjdFZhbHVlVHlwZXMuaGFzKG5vcm1hbGl6ZWRUeXBlKVxuXG4gICAgICBpZiAoIXN1cHBvcnRzT2JqZWN0VmFsdWVzKSB7XG4gICAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsV2hlcmVOb01hdGNoU3ltYm9sXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIGdyb3VwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEdyb3VwIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEdyb3VwfSBhcmdzLmdyb3VwIC0gR3JvdXAgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxHcm91cCh7cXVlcnksIGdyb3VwfSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlYXJjaFRhcmdldE1vZGVsQ2xhc3Moe1xuICAgICAgbW9kZWxDbGFzcyxcbiAgICAgIHBhdGg6IGdyb3VwLnBhdGhcbiAgICB9KVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLnJlc29sdmVGcm9udGVuZE1vZGVsUXVlcnlhYmxlQ29sdW1uTmFtZSh7XG4gICAgICBhdHRyaWJ1dGVOYW1lOiBncm91cC5jb2x1bW4sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJncm91cFwiXG4gICAgfSlcblxuICAgIGlmICghY29sdW1uTmFtZSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRNb2RlbFF1ZXJ5RXJyb3IoYFVua25vd24gZ3JvdXAgY29sdW1uIFwiJHtncm91cC5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsSm9pblBhdGgoe3BhdGg6IGdyb3VwLnBhdGgsIHF1ZXJ5fSlcblxuICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLmdyb3VwLnBhdGgpXG4gICAgY29uc3QgY29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxHcm91cENvbHVtbih7Y29sdW1uU3FsLCBxdWVyeX0pXG4gIH1cblxuICAvKipcbiAgICogQWRkcyByb290LW1vZGVsIGNvbHVtbnMgdG8gR1JPVVAgQlkgc28gc3RyaWN0IFNRTCBlbmdpbmVzIGFjY2VwdCBkZWZhdWx0IHJvb3QtdGFibGUgc2VsZWN0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFwcGx5RnJvbnRlbmRNb2RlbFJvb3RHcm91cENvbHVtbnMoe3F1ZXJ5fSkge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3Qgcm9vdFRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKClcblxuICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBvZiBPYmplY3QudmFsdWVzKGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXApKSB7XG4gICAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZShyb290VGFibGVSZWZlcmVuY2UpfS4ke3F1ZXJ5LmRyaXZlci5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX1gXG5cbiAgICAgIHRoaXMuZW5zdXJlRnJvbnRlbmRNb2RlbEdyb3VwQ29sdW1uKHtjb2x1bW5TcWwsIHF1ZXJ5fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBhIGdyb3VwLWJ5IFNRTCBjb2x1bW4gaXMgb25seSBhcHBlbmRlZCBvbmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtblNxbCAtIEZ1bGx5LXF1YWxpZmllZCBjb2x1bW4gU1FMLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVuc3VyZUZyb250ZW5kTW9kZWxHcm91cENvbHVtbih7Y29sdW1uU3FsLCBxdWVyeX0pIHtcbiAgICBjb25zdCBxdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpXG4gICAgY29uc3QgZ3JvdXBlZENvbHVtbnMgPSBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxHcm91cGVkQ29sdW1uc1N5bWJvbF0gfHwgbmV3IFNldCgpXG5cbiAgICBpZiAoZ3JvdXBlZENvbHVtbnMuaGFzKGNvbHVtblNxbCkpIHJldHVyblxuXG4gICAgcXVlcnkuZ3JvdXAoY29sdW1uU3FsKVxuICAgIGdyb3VwZWRDb2x1bW5zLmFkZChjb2x1bW5TcWwpXG4gICAgcXVlcnlNZXRhZGF0YVtmcm9udGVuZE1vZGVsR3JvdXBlZENvbHVtbnNTeW1ib2xdID0gZ3JvdXBlZENvbHVtbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFwcGx5IGZyb250ZW5kIG1vZGVsIHRyYW5zbGF0ZWQgYXR0cmlidXRlIHByZWxvYWRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBRdWVyeSB3aXRoIHRyYW5zbGF0aW9ucyBwcmVsb2FkZWQgaWYgbmVlZGVkLlxuICAgKi9cbiAgYXBwbHlGcm9udGVuZE1vZGVsVHJhbnNsYXRlZEF0dHJpYnV0ZVByZWxvYWRzKHtxdWVyeX0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbEVmZmVjdGl2ZVNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcywgdGhpcy5mcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHx8IFtdKVxuICAgICAgfHwgdGhpcy5mcm9udGVuZE1vZGVsRGVmYXVsdEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgICBpZiAoIXNlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHF1ZXJ5XG5cbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuICAgIGNvbnN0IHJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gKi8gKHJlc291cmNlLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRTZXQgPSBuZXcgU2V0KHJlc291cmNlQ2xhc3MudHJhbnNsYXRlZEF0dHJpYnV0ZXNDb25maWcoKSB8fCBbXSlcbiAgICBsZXQgbmVlZHNUcmFuc2xhdGlvbnMgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHNlbGVjdGVkQXR0cmlidXRlcykge1xuICAgICAgY29uc3QgaG9va05hbWUgPSBgJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZVNlbGVjdGVkYFxuICAgICAgY29uc3QgZHluYW1pY1Jlc291cmNlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVzb3VyY2UpKVxuXG4gICAgICBpZiAodHlwZW9mIGR5bmFtaWNSZXNvdXJjZVtob29rTmFtZV0gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBkeW5hbWljUmVzb3VyY2VbaG9va05hbWVdKHtxdWVyeX0pXG5cbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIHF1ZXJ5ID0gcmVzdWx0XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodHJhbnNsYXRlZFNldC5oYXMoYXR0cmlidXRlTmFtZSkpIHtcbiAgICAgICAgbmVlZHNUcmFuc2xhdGlvbnMgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG5lZWRzVHJhbnNsYXRpb25zKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LnByZWxvYWQoe3RyYW5zbGF0aW9uczoge319KVxuICAgIH1cblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbHkgZnJvbnRlbmQgbW9kZWwgc29ydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTb3J0IGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFNvcnR9IGFyZ3Muc29ydCAtIFNvcnQgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhcHBseUZyb250ZW5kTW9kZWxTb3J0KHtxdWVyeSwgc29ydH0pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5mcm9udGVuZE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSB0aGlzLmZyb250ZW5kTW9kZWxTZWFyY2hUYXJnZXRNb2RlbENsYXNzKHtcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBwYXRoOiBzb3J0LnBhdGhcbiAgICB9KVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVzTWFwID0gdGFyZ2V0TW9kZWxDbGFzcy5nZXRUcmFuc2xhdGlvbnNNYXAoKVxuICAgIGNvbnN0IHRyYW5zbGF0ZWRBdHRyaWJ1dGVOYW1lcyA9IE9iamVjdC5rZXlzKHRyYW5zbGF0ZWRBdHRyaWJ1dGVzTWFwKVxuICAgIGNvbnN0IGlzVHJhbnNsYXRlZFNvcnRBdHRyaWJ1dGUgPSB0cmFuc2xhdGVkQXR0cmlidXRlTmFtZXMuaW5jbHVkZXMoc29ydC5jb2x1bW4pXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lID0gdGhpcy5yZXNvbHZlRnJvbnRlbmRNb2RlbFF1ZXJ5YWJsZUNvbHVtbk5hbWUoe1xuICAgICAgYXR0cmlidXRlTmFtZTogc29ydC5jb2x1bW4sXG4gICAgICBtb2RlbENsYXNzOiB0YXJnZXRNb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJzb3J0XCJcbiAgICB9KVxuICAgIGNvbnN0IGRpcmVjdGlvbiA9IHNvcnQuZGlyZWN0aW9uLnRvVXBwZXJDYXNlKClcblxuICAgIGlmIChpc1RyYW5zbGF0ZWRTb3J0QXR0cmlidXRlKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGlvbk1vZGVsQ2xhc3MgPSB0YXJnZXRNb2RlbENsYXNzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgICAgY29uc3QgdHJhbnNsYXRpb25BdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwID0gdHJhbnNsYXRpb25Nb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgICAgY29uc3QgdHJhbnNsYXRpb25Db2x1bW5OYW1lID0gdHJhbnNsYXRpb25BdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwW3NvcnQuY29sdW1uXVxuICAgICAgY29uc3QgdHJhbnNsYXRpb25QYXRoID0gc29ydC5wYXRoLmNvbmNhdChbXCJjdXJyZW50VHJhbnNsYXRpb25cIl0pXG5cbiAgICAgIGlmICghdHJhbnNsYXRpb25Db2x1bW5OYW1lKSB7XG4gICAgICAgIHRocm93IGZyb250ZW5kTW9kZWxRdWVyeUVycm9yKGBVbmtub3duIHRyYW5zbGF0ZWQgc29ydCBjb2x1bW4gXCIke3NvcnQuY29sdW1ufVwiIGZvciAke3RhcmdldE1vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgfVxuXG4gICAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxTb3J0Sm9pblBhdGgoe3BhdGg6IHRyYW5zbGF0aW9uUGF0aCwgcXVlcnl9KVxuXG4gICAgICBjb25zdCB0cmFuc2xhdGlvblRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnRyYW5zbGF0aW9uUGF0aClcbiAgICAgIGNvbnN0IHRyYW5zbGF0aW9uQ29sdW1uU3FsID0gYCR7cXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodHJhbnNsYXRpb25UYWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKHRyYW5zbGF0aW9uQ29sdW1uTmFtZSl9YFxuXG4gICAgICBxdWVyeS5vcmRlcihgJHt0cmFuc2xhdGlvbkNvbHVtblNxbH0gJHtkaXJlY3Rpb259YClcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZE1vZGVsUXVlcnlFcnJvcihgVW5rbm93biBzb3J0IGNvbHVtbiBcIiR7c29ydC5jb2x1bW59XCIgZm9yICR7dGFyZ2V0TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgfVxuXG4gICAgdGhpcy5lbnN1cmVGcm9udGVuZE1vZGVsU29ydEpvaW5QYXRoKHtwYXRoOiBzb3J0LnBhdGgsIHF1ZXJ5fSlcblxuICAgIGNvbnN0IHRhYmxlUmVmZXJlbmNlID0gcXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnNvcnQucGF0aClcbiAgICBjb25zdCBjb2x1bW5TcWwgPSBgJHtxdWVyeS5kcml2ZXIucXVvdGVUYWJsZSh0YWJsZVJlZmVyZW5jZSl9LiR7cXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfWBcblxuICAgIHF1ZXJ5Lm9yZGVyKGAke2NvbHVtblNxbH0gJHtkaXJlY3Rpb259YClcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGEgc29ydCBqb2luIHBhdGggaGFzIGJlZW4gam9pbmVkIG9uIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEpvaW4gYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5wYXRoIC0gUmVsYXRpb25zaGlwIGpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBlbnN1cmVGcm9udGVuZE1vZGVsU29ydEpvaW5QYXRoKHtwYXRoLCBxdWVyeX0pIHtcbiAgICB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aCwgcXVlcnl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYSByZWxhdGlvbnNoaXAgcGF0aCBoYXMgZXhhY3RseSBvbmUgU1FMIGpvaW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gSm9pbiBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLnBhdGggLSBSZWxhdGlvbnNoaXAgam9pbiBwYXRoLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gYXJncy5xdWVyeSAtIFF1ZXJ5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGVuc3VyZUZyb250ZW5kTW9kZWxKb2luUGF0aCh7cGF0aCwgcXVlcnl9KSB7XG4gICAgaWYgKHBhdGgubGVuZ3RoIDwgMSkgcmV0dXJuXG5cbiAgICBjb25zdCBxdWVyeU1ldGFkYXRhID0gZnJvbnRlbmRNb2RlbFF1ZXJ5TWV0YWRhdGEocXVlcnkpXG4gICAgY29uc3Qgam9pbmVkUGF0aHMgPSBxdWVyeU1ldGFkYXRhW2Zyb250ZW5kTW9kZWxKb2luZWRQYXRoc1N5bWJvbF0gfHwgbmV3IFNldCgpXG4gICAgY29uc3QgcGF0aEtleSA9IHBhdGguam9pbihcIi5cIilcblxuICAgIGlmIChqb2luZWRQYXRocy5oYXMocGF0aEtleSkpIHJldHVyblxuXG4gICAgcXVlcnkuam9pbnMoYnVpbGRGcm9udGVuZE1vZGVsSm9pbk9iamVjdEZyb21QYXRoKHBhdGgpKVxuICAgIGpvaW5lZFBhdGhzLmFkZChwYXRoS2V5KVxuICAgIHF1ZXJ5TWV0YWRhdGFbZnJvbnRlbmRNb2RlbEpvaW5lZFBhdGhzU3ltYm9sXSA9IGpvaW5lZFBhdGhzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3RlZCBhdHRyaWJ1dGVzIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIFNlbGVjdGVkIGF0dHJpYnV0ZXMgZm9yIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IHNlbGVjdCA9IHRoaXMuZnJvbnRlbmRNb2RlbFNlbGVjdCgpXG5cbiAgICBpZiAoIXNlbGVjdCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNlbGVjdGVkQXR0cmlidXRlcyA9IHNlbGVjdFttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXSB8fCBudWxsXG5cbiAgICBpZiAoIXNlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLmFzc2VydEZyb250ZW5kTW9kZWxTZWxlY3RlZEF0dHJpYnV0ZXNBbGxvd2VkKHtcbiAgICAgIGF0dHJpYnV0ZU5hbWVzOiBzZWxlY3RlZEF0dHJpYnV0ZXMsXG4gICAgICBtb2RlbENsYXNzLFxuICAgICAgb3BlcmF0aW9uTmFtZTogXCJzZWxlY3RcIlxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBzZWxlY3RzIGV4dHJhIGZvciBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW10gfCBudWxsfSAtIEV4dHJhIGF0dHJpYnV0ZXMgKGxvYWRlZCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdHMpIGZvciB0aGUgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgY29uc3Qgc2VsZWN0c0V4dHJhID0gdGhpcy5mcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhKClcblxuICAgIGlmICghc2VsZWN0c0V4dHJhKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZXh0cmFBdHRyaWJ1dGVzID0gc2VsZWN0c0V4dHJhW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldIHx8IG51bGxcblxuICAgIGlmICghZXh0cmFBdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHRoaXMuYXNzZXJ0RnJvbnRlbmRNb2RlbFNlbGVjdGVkQXR0cmlidXRlc0FsbG93ZWQoe1xuICAgICAgYXR0cmlidXRlTmFtZXM6IGV4dHJhQXR0cmlidXRlcyxcbiAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICBvcGVyYXRpb25OYW1lOiBcInNlbGVjdHNFeHRyYVwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZmluYWwgc2V0IG9mIGF0dHJpYnV0ZSBuYW1lcyB0byBzZXJpYWxpemUgZm9yIGEgbW9kZWwgY2xhc3M6XG4gICAqIGFuIGV4cGxpY2l0IG5hcnJvd2luZyBgc2VsZWN0YCB3aW5zOyBvdGhlcndpc2UsIHdoZW4gYHNlbGVjdHNFeHRyYWAgaXMgZ2l2ZW4sXG4gICAqIHRoZSBkZWZhdWx0IGF0dHJpYnV0ZXMgcGx1cyB0aGUgZXh0cmFzOyBvdGhlcndpc2UgbnVsbCAoZGVmYXVsdCBiZWhhdmlvcikuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZmFsbGJhY2tBdHRyaWJ1dGVOYW1lcyAtIEF0dHJpYnV0ZSBuYW1lcyB0byB0cmVhdCBhcyB0aGUgZGVmYXVsdHMgd2hlbiB0aGUgcmVzb3VyY2UgZGVjbGFyZXMgbm9uZS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdIHwgbnVsbH0gLSBFZmZlY3RpdmUgc2VsZWN0ZWQgYXR0cmlidXRlIG5hbWVzLCBvciBudWxsIGZvciBkZWZhdWx0IHNlcmlhbGl6YXRpb24uXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRWZmZWN0aXZlU2VsZWN0ZWRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzLCBmYWxsYmFja0F0dHJpYnV0ZU5hbWVzKSB7XG4gICAgY29uc3Qgc2VsZWN0ZWRBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VsZWN0ZWRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKHNlbGVjdGVkQXR0cmlidXRlcykgcmV0dXJuIHNlbGVjdGVkQXR0cmlidXRlc1xuXG4gICAgY29uc3QgZXh0cmFBdHRyaWJ1dGVzID0gdGhpcy5mcm9udGVuZE1vZGVsU2VsZWN0c0V4dHJhRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFleHRyYUF0dHJpYnV0ZXMpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkZWZhdWx0QXR0cmlidXRlcyA9IHRoaXMuZnJvbnRlbmRNb2RlbERlZmF1bHRBdHRyaWJ1dGVzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB8fCBmYWxsYmFja0F0dHJpYnV0ZU5hbWVzXG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXcgU2V0KFsuLi5kZWZhdWx0QXR0cmlidXRlcywgLi4uZXh0cmFBdHRyaWJ1dGVzXSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBkZWZhdWx0IGF0dHJpYnV0ZXMgZm9yIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IG51bGx9IC0gRGVmYXVsdCBmcm9udGVuZC1tb2RlbCBhdHRyaWJ1dGVzIGRlY2xhcmVkIG9uIHRoZSByZXNvdXJjZS5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxEZWZhdWx0QXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbkZvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlPy5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYXR0cmlidXRlc1xuXG4gICAgaWYgKCFhdHRyaWJ1dGVzKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpIHtcbiAgICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gICAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRydWVcblxuICAgICAgICAgIGNvbnN0IGNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZW50cnkpXG5cbiAgICAgICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy5zZWxlY3RlZEJ5RGVmYXVsdCA9PT0gZmFsc2UpIHJldHVybiBmYWxzZVxuXG4gICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgfSlcbiAgICAgICAgLm1hcCgoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiA/IGVudHJ5IDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChlbnRyeSkubmFtZSlcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZXMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHJldHVybiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKVxuICAgICAgICAuZmlsdGVyKChbLCBjb25maWddKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWcgfHwgdHlwZW9mIGNvbmZpZyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHRydWVcblxuICAgICAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNvbmZpZykuc2VsZWN0ZWRCeURlZmF1bHQgIT09IGZhbHNlXG4gICAgICAgIH0pXG4gICAgICAgIC5tYXAoKFtuYW1lXSkgPT4gbmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVsIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBTZXJpYWxpemVkIGF0dHJpYnV0ZXMgZmlsdGVyZWQgYnkgc2VsZWN0IG1hcC5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChtb2RlbC5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBtb2RlbEF0dHJpYnV0ZXMgPSBtb2RlbC5hdHRyaWJ1dGVzKClcbiAgICBjb25zdCBzZWxlY3RlZEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxFZmZlY3RpdmVTZWxlY3RlZEF0dHJpYnV0ZXNGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MsIE9iamVjdC5rZXlzKG1vZGVsQXR0cmlidXRlcykpXG4gICAgY29uc3QgZGVmYXVsdEF0dHJpYnV0ZXMgPSB0aGlzLmZyb250ZW5kTW9kZWxEZWZhdWx0QXR0cmlidXRlc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcbiAgICBjb25zdCByZXNvdXJjZUluc3RhbmNlID0gdGhpcy5fc2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VGb3JNb2RlbChtb2RlbClcblxuICAgIC8qKlxuICAgICAqIFJlc291cmNlIGF0dHJpYnV0ZSBtZXRob2QgbmFtZS5cbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUmVzb3VyY2UgYXR0cmlidXRlIG1ldGhvZCBuYW1lLlxuICAgICAqL1xuICAgIGNvbnN0IHJlc291cmNlQXR0cmlidXRlTWV0aG9kTmFtZSA9IChhdHRyaWJ1dGVOYW1lKSA9PiBgJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZWBcblxuICAgIC8qKlxuICAgICAqIFJlc291cmNlIGhhcyBhdHRyaWJ1dGUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTxGcm9udGVuZE1vZGVsQmFzZVJlc291cmNlW1wicmVzb3VyY2VNZXRob2RcIl0+fSAtIFJlc291cmNlIGF0dHJpYnV0ZSBtZXRob2QgZGV0YWlscy5cbiAgICAgKi9cbiAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZU1ldGhvZCA9IChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBjb25zdCBtZXRob2ROYW1lID0gcmVzb3VyY2VBdHRyaWJ1dGVNZXRob2ROYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIHJldHVybiByZXNvdXJjZUluc3RhbmNlPy5yZXNvdXJjZU1ldGhvZChtZXRob2ROYW1lKSB8fCBudWxsXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUHJvdG90eXBlIGF0dHJpYnV0ZSBtZXRob2QuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7e21ldGhvZDogKC4uLmFyZ3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG93bmVyTmFtZTogc3RyaW5nfSB8IHVuZGVmaW5lZH0gLSBQcm90b3R5cGUgbWV0aG9kIGRldGFpbHMgd2hlbiBwcmVzZW50LlxuICAgICAqL1xuICAgIGNvbnN0IHByb3RvdHlwZUF0dHJpYnV0ZU1ldGhvZCA9IChhdHRyaWJ1dGVOYW1lKSA9PiB7XG4gICAgICBsZXQgY3VycmVudFByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihtb2RlbClcblxuICAgICAgd2hpbGUgKGN1cnJlbnRQcm90b3R5cGUgJiYgY3VycmVudFByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKGN1cnJlbnRQcm90b3R5cGUsIGF0dHJpYnV0ZU5hbWUpPy52YWx1ZVxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgbWV0aG9kOiBjYW5kaWRhdGUsXG4gICAgICAgICAgICBvd25lck5hbWU6IGN1cnJlbnRQcm90b3R5cGUuY29uc3RydWN0b3I/Lm5hbWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjdXJyZW50UHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRQcm90b3R5cGUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU2VyaWFsaXplZCBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2VyaWFsaXplZCBhdHRyaWJ1dGUgdmFsdWUuXG4gICAgICovXG4gICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZVZhbHVlID0gYXN5bmMgKGF0dHJpYnV0ZU5hbWUpID0+IHtcbiAgICAgIC8vIENoZWNrIHJlc291cmNlIGluc3RhbmNlIGZpcnN0ICh2aXJ0dWFsL2NvbXB1dGVkIGF0dHJpYnV0ZXMgdmlhICR7bmFtZX1BdHRyaWJ1dGUgY29udmVudGlvbilcbiAgICAgIGNvbnN0IHJlc291cmNlQXR0cmlidXRlID0gcmVzb3VyY2VBdHRyaWJ1dGVNZXRob2QoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKHJlc291cmNlQXR0cmlidXRlKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCByZXNvdXJjZUF0dHJpYnV0ZS5tZXRob2QuY2FsbChyZXNvdXJjZUF0dHJpYnV0ZS5yZXNvdXJjZSwgbW9kZWwpXG4gICAgICB9XG5cbiAgICAgIC8vIEZhbGwgYmFjayB0byBtb2RlbCBtZXRob2RcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZExvb2t1cCA9IHByb3RvdHlwZUF0dHJpYnV0ZU1ldGhvZChhdHRyaWJ1dGVOYW1lKVxuICAgICAgY29uc3QgYXR0cmlidXRlTWV0aG9kID0gYXR0cmlidXRlTWV0aG9kTG9va3VwPy5tZXRob2RcblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gYXdhaXQgYXR0cmlidXRlTWV0aG9kLmNhbGwobW9kZWwpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBtb2RlbEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBBdHRyaWJ1dGUgZXhpc3RzLlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgYXR0cmlidXRlIGV4aXN0cy5cbiAgICAgKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVFeGlzdHMgPSAoYXR0cmlidXRlTmFtZSkgPT4ge1xuICAgICAgcmV0dXJuIChhdHRyaWJ1dGVOYW1lIGluIG1vZGVsQXR0cmlidXRlcykgfHwgKGF0dHJpYnV0ZU5hbWUgaW4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChtb2RlbCkpIHx8IEJvb2xlYW4ocmVzb3VyY2VBdHRyaWJ1dGVNZXRob2QoYXR0cmlidXRlTmFtZSkpXG4gICAgfVxuXG4gICAgaWYgKCFzZWxlY3RlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGlmICghZGVmYXVsdEF0dHJpYnV0ZXMgfHwgZGVmYXVsdEF0dHJpYnV0ZXMubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXR1cm4gbW9kZWxBdHRyaWJ1dGVzXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogU2VyaWFsaXplZCBhdHRyaWJ1dGVzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVzID0ge31cblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGRlZmF1bHRBdHRyaWJ1dGVzKSB7XG4gICAgICAgIGlmICghYXR0cmlidXRlRXhpc3RzKGF0dHJpYnV0ZU5hbWUpKSBjb250aW51ZVxuICAgICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVWYWx1ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gc2VyaWFsaXplZEF0dHJpYnV0ZXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVkIGF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBzZXJpYWxpemVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2Ygc2VsZWN0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBpZiAoIWF0dHJpYnV0ZUV4aXN0cyhhdHRyaWJ1dGVOYW1lKSkgY29udGludWVcbiAgICAgIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgc2VyaWFsaXplZEF0dHJpYnV0ZVZhbHVlKGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuXG4gICAgcmV0dXJuIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcmVxdWVzdC1zY29wZWQgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZSBjYWNoZS5cbiAgICogQHJldHVybnMge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPGJvb2xlYW4sIGltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pj59IC0gQ2FjaGUuXG4gICAqL1xuICBfZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMpIHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXMgPSBuZXcgTWFwKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlc1xuICB9XG5cbiAgLyoqXG4gICAqIExvb2tzIHVwIGEgY2FjaGVkIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBpc1JlbGF0ZWQgLSBXaGV0aGVyIHRoZSByZXNvdXJjZSBpcyBmb3IgYSByZWxhdGVkIChub24tcm9vdCkgbW9kZWwuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDYWNoZWQgcmVzb3VyY2Ugb3IgdW5kZWZpbmVkLlxuICAgKi9cbiAgX2NhY2hlZFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlKG1vZGVsQ2xhc3MsIGlzUmVsYXRlZCkge1xuICAgIHJldHVybiB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VzTWFwKCkuZ2V0KG1vZGVsQ2xhc3MpPy5nZXQoaXNSZWxhdGVkKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyBhIHNlcmlhbGl6YXRpb24gcmVzb3VyY2UgaW5zdGFuY2UgaW4gdGhlIHJlcXVlc3Qtc2NvcGVkIGNhY2hlLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNSZWxhdGVkIC0gV2hldGhlciB0aGUgcmVzb3VyY2UgaXMgZm9yIGEgcmVsYXRlZCAobm9uLXJvb3QpIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSByZXNvdXJjZSAtIFJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDYWNoZWRTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZShtb2RlbENsYXNzLCBpc1JlbGF0ZWQsIHJlc291cmNlKSB7XG4gICAgY29uc3QgYnlDbGFzcyA9IHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZXNNYXAoKVxuICAgIGxldCBieVJlbGF0ZWQgPSBieUNsYXNzLmdldChtb2RlbENsYXNzKVxuXG4gICAgaWYgKCFieVJlbGF0ZWQpIHtcbiAgICAgIGJ5UmVsYXRlZCA9IG5ldyBNYXAoKVxuICAgICAgYnlDbGFzcy5zZXQobW9kZWxDbGFzcywgYnlSZWxhdGVkKVxuICAgIH1cblxuICAgIGJ5UmVsYXRlZC5zZXQoaXNSZWxhdGVkLCByZXNvdXJjZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIGEgcGVyLWluc3RhbmNlIGhvb2sgaW52b2tlZCBmb3IgZXZlcnkgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZVxuICAgKiByZXNvbHV0aW9uLiBUaGUgaG9vayBpcyBzY29wZWQgdG8gdGhpcyBjb250cm9sbGVyOyBpdCBuZXZlciBhZmZlY3RzIG90aGVyXG4gICAqIGNvbnRyb2xsZXIgaW5zdGFuY2VzLiBQYXNzaW5nIGBudWxsYCBjbGVhcnMgdGhlIGhvb2suXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayB8IG51bGx9IGhvb2sgLSBIb29rIGNhbGxiYWNrIG9yIG51bGwuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENsZWFudXAgZnVuY3Rpb24gdGhhdCByZXN0b3JlcyB0aGUgcHJldmlvdXMgaG9vay5cbiAgICovXG4gIHNldFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayhob29rKSB7XG4gICAgY29uc3QgcHJldmlvdXNIb29rID0gdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9va1xuXG4gICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayA9IGhvb2tcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICB0aGlzLl9mcm9udGVuZE1vZGVsU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VIb29rID0gcHJldmlvdXNIb29rXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXphdGlvbiByZXNvdXJjZSBpbnN0YW5jZSBmb3IgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gLSBSZXNvdXJjZSBpbnN0YW5jZSBvciBudWxsLlxuICAgKi9cbiAgX3NlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlRm9yTW9kZWwobW9kZWwpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKG1vZGVsLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IGlzUmVsYXRlZCA9IG1vZGVsQ2xhc3MgIT09IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBjYWNoZWRSZXNvdXJjZSA9IHRoaXMuX2NhY2hlZFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlKG1vZGVsQ2xhc3MsIGlzUmVsYXRlZClcblxuICAgIGlmIChjYWNoZWRSZXNvdXJjZSkge1xuICAgICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2spIHtcbiAgICAgICAgdGhpcy5fZnJvbnRlbmRNb2RlbFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlSG9vayhtb2RlbCwgY2FjaGVkUmVzb3VyY2UpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjYWNoZWRSZXNvdXJjZVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgIGxldCByZXNvdXJjZVxuXG4gICAgaWYgKCFpc1JlbGF0ZWQpIHtcbiAgICAgIHJlc291cmNlID0gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VJbnN0YW5jZSgpXG5cbiAgICAgIHRoaXMuX3NldENhY2hlZFNlcmlhbGl6YXRpb25SZXNvdXJjZUluc3RhbmNlKG1vZGVsQ2xhc3MsIGZhbHNlLCByZXNvdXJjZSlcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgICBjb25zdCBiYWNrZW5kUHJvamVjdHMgPSBjb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICBjb25zdCBtb2RlbENsYXNzTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICAgICAgcmVzb3VyY2UgPSBudWxsXG5cbiAgICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZXNXaXRoQnVpbHRJbnNGb3JCYWNrZW5kUHJvamVjdChiYWNrZW5kUHJvamVjdClcbiAgICAgICAgY29uc3QgcmVzb3VyY2VEZWZpbml0aW9uID0gcmVzb3VyY2VzW21vZGVsQ2xhc3NOYW1lXVxuICAgICAgICBjb25zdCByZXNvdXJjZUNsYXNzID0gcmVzb3VyY2VEZWZpbml0aW9uID8gZnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NGcm9tRGVmaW5pdGlvbihyZXNvdXJjZURlZmluaXRpb24pIDogbnVsbFxuXG4gICAgICAgIGlmIChyZXNvdXJjZUNsYXNzKSB7XG4gICAgICAgICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IocmVzb3VyY2VDbGFzcylcblxuICAgICAgICAgIHJlc291cmNlID0gbmV3IFJlc291cmNlQ2xhc3Moe1xuICAgICAgICAgICAgYWJpbGl0eTogdGhpcy5jdXJyZW50QWJpbGl0eSgpLFxuICAgICAgICAgICAgLy8gUHJvcGFnYXRlIHRoZSBjb250cm9sbGVyIHNvIGEgcmVsYXRlZC9wcmVsb2FkZWQgbW9kZWwncyBzZXJpYWxpemF0aW9uXG4gICAgICAgICAgICAvLyByZXNvdXJjZSBjYW4gdXNlIHJlcXVlc3QgY29udGV4dCAoZS5nLiBgcmVxdWVzdEJhc2VVcmwoKWAgZm9yIHNpZ25lZFxuICAgICAgICAgICAgLy8gZG93bmxvYWQgVVJMcykuIFdpdGhvdXQgaXQsIGFueSBgPGF0dHI+QXR0cmlidXRlYCBtZXRob2QgdGhhdCByZWFjaGVzXG4gICAgICAgICAgICAvLyBmb3IgdGhlIGNvbnRyb2xsZXIgdGhyb3dzIFwicmVxdWlyZXMgYSBjb250cm9sbGVyIGluc3RhbmNlLlwiIHdoZW4gYVxuICAgICAgICAgICAgLy8gcmVsYXRpb25zaGlwIGlzIHNlcmlhbGl6ZWQgYXMgYSBwcmVsb2FkLlxuICAgICAgICAgICAgY29udHJvbGxlcjogdGhpcyxcbiAgICAgICAgICAgIGNvbnRleHQ6IHRoaXMuY3VycmVudEFiaWxpdHkoKT8uZ2V0Q29udGV4dCgpIHx8IHt9LFxuICAgICAgICAgICAgbG9jYWxzOiB0aGlzLmN1cnJlbnRBYmlsaXR5KCk/LmdldExvY2FscygpIHx8IHt9LFxuICAgICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICAgIG1vZGVsTmFtZTogbW9kZWxDbGFzc05hbWUsXG4gICAgICAgICAgICBwYXJhbXM6IHt9LFxuICAgICAgICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiByZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKClcbiAgICAgICAgICB9KVxuXG4gICAgICAgICAgdGhpcy5fc2V0Q2FjaGVkU2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2UobW9kZWxDbGFzcywgdHJ1ZSwgcmVzb3VyY2UpXG5cbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2spIHtcbiAgICAgIHRoaXMuX2Zyb250ZW5kTW9kZWxTZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUhvb2sobW9kZWwsIHJlc291cmNlKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvdXJjZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgZmlsdGVyIHNlcmlhbGl6YWJsZSByZWxhdGVkIG1vZGVscy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdfSBhcmdzLm1vZGVscyAtIEZyb250ZW5kIG1vZGVsIHJlY29yZHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5yZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb24gLSBXaGV0aGVyIHJlbGF0aW9uIGlzIGhhcy1tYW55LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W10+fSAtIFNlcmlhbGl6YWJsZSByZWxhdGVkIG1vZGVscy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxGaWx0ZXJTZXJpYWxpemFibGVSZWxhdGVkTW9kZWxzKHttb2RlbHMsIHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvbn0pIHtcbiAgICBpZiAoIXRoaXMuY3VycmVudEFiaWxpdHkoKSkgcmV0dXJuIG1vZGVsc1xuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm4gbW9kZWxzXG5cbiAgICAvKipcbiAgICAgKiBNb2RlbHMgYnkgY2xhc3MuXG4gICAgICogQHR5cGUge01hcDx0eXBlb2YgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCwgaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdPn0gKi9cbiAgICBjb25zdCBtb2RlbHNCeUNsYXNzID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCBleGlzdGluZ01vZGVsc0ZvckNsYXNzID0gbW9kZWxzQnlDbGFzcy5nZXQocmVsYXRlZE1vZGVsQ2xhc3MpIHx8IFtdXG5cbiAgICAgIGV4aXN0aW5nTW9kZWxzRm9yQ2xhc3MucHVzaChtb2RlbClcbiAgICAgIG1vZGVsc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBleGlzdGluZ01vZGVsc0ZvckNsYXNzKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEF1dGhvcml6ZWQgaWRzIGJ5IGNsYXNzLlxuICAgICAqIEB0eXBlIHtNYXA8dHlwZW9mIGltcG9ydChcIi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIFNldDxzdHJpbmc+Pn0gKi9cbiAgICBjb25zdCBhdXRob3JpemVkSWRzQnlDbGFzcyA9IG5ldyBNYXAoKVxuICAgIC8qKlxuICAgICAqIFByaW1hcnkga2V5cyBieSBjbGFzcy5cbiAgICAgKiBAdHlwZSB7TWFwPHR5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBpbXBvcnQoXCIuL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCIpLk1vZGVsUHJpbWFyeUtleURlZmluaXRpb24+fSAqL1xuICAgIGNvbnN0IHByaW1hcnlLZXlzQnlDbGFzcyA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBbcmVsYXRlZE1vZGVsQ2xhc3MsIHJlbGF0ZWRNb2RlbHNdIG9mIG1vZGVsc0J5Q2xhc3MuZW50cmllcygpKSB7XG4gICAgICBjb25zdCByZWxhdGVkUmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JNb2RlbENsYXNzKHJlbGF0ZWRNb2RlbENsYXNzKVxuXG4gICAgICBpZiAoIXJlbGF0ZWRSZXNvdXJjZSkge1xuICAgICAgICBhdXRob3JpemVkSWRzQnlDbGFzcy5zZXQocmVsYXRlZE1vZGVsQ2xhc3MsIG5ldyBTZXQoKSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJpbGl0eUFjdGlvbiA9IHJlbGF0aW9uc2hpcElzQ29sbGVjdGlvblxuICAgICAgICA/IHJlbGF0ZWRSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzPy5pbmRleFxuICAgICAgICA6IHJlbGF0ZWRSZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb24uYWJpbGl0aWVzPy5maW5kXG5cbiAgICAgIGlmICh0eXBlb2YgYWJpbGl0eUFjdGlvbiAhPT0gXCJzdHJpbmdcIiB8fCBhYmlsaXR5QWN0aW9uLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgYXV0aG9yaXplZElkc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBuZXcgU2V0KCkpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHByaW1hcnlLZXkgPSByZWxhdGVkTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IGlkZW50aXRpZXMgPSByZWxhdGVkTW9kZWxzLm1hcCgobW9kZWwpID0+IG1vZGVsLmlkKCkpXG4gICAgICBjb25zdCBhdXRob3JpemVkSWRzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQXV0aG9yaXplZElkZW50aXR5U2V0KHtcbiAgICAgICAgaWRlbnRpdGllcyxcbiAgICAgICAgbW9kZWxDbGFzczogcmVsYXRlZE1vZGVsQ2xhc3MsXG4gICAgICAgIHByaW1hcnlLZXksXG4gICAgICAgIHF1ZXJ5OiByZWxhdGVkTW9kZWxDbGFzcy5hY2Nlc3NpYmxlRm9yKGFiaWxpdHlBY3Rpb24pXG4gICAgICB9KVxuXG4gICAgICBwcmltYXJ5S2V5c0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBwcmltYXJ5S2V5KVxuICAgICAgYXV0aG9yaXplZElkc0J5Q2xhc3Muc2V0KHJlbGF0ZWRNb2RlbENsYXNzLCBhdXRob3JpemVkSWRzKVxuICAgIH1cblxuICAgIHJldHVybiBtb2RlbHMuZmlsdGVyKChtb2RlbCkgPT4ge1xuICAgICAgY29uc3QgcmVsYXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCBhdXRob3JpemVkSWRzID0gYXV0aG9yaXplZElkc0J5Q2xhc3MuZ2V0KHJlbGF0ZWRNb2RlbENsYXNzKVxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHByaW1hcnlLZXlzQnlDbGFzcy5nZXQocmVsYXRlZE1vZGVsQ2xhc3MpXG5cbiAgICAgIGlmICghYXV0aG9yaXplZElkcyB8fCAhcHJpbWFyeUtleSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIHJldHVybiBhdXRob3JpemVkSWRzLmhhcyhtb2RlbFByaW1hcnlLZXlDYWNoZUtleShwcmltYXJ5S2V5LCBtb2RlbC5pZCgpKSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgc2VyaWFsaXphYmxlIGZyb250ZW5kIG1vZGVsLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSBwcmVsb2FkZWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2YWx1ZSBpcyBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFdoZXRoZXIgdmFsdWUgYmVoYXZlcyBsaWtlIGEgbW9kZWwuXG4gICAqL1xuICBpc1NlcmlhbGl6YWJsZUZyb250ZW5kTW9kZWwodmFsdWUpIHtcbiAgICByZXR1cm4gQm9vbGVhbih2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh2YWx1ZSkuYXR0cmlidXRlcyA9PT0gXCJmdW5jdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2VyaWFsaXplIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0W119IG1vZGVscyAtIE1vZGVscyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdPn0gLSBTZXJpYWxpemVkIG1vZGVsIHBheWxvYWRzLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMobW9kZWxzKSB7XG4gICAgaWYgKG1vZGVscy5sZW5ndGggPCAxKSByZXR1cm4gW11cblxuICAgIC8qKlxuICAgICAqIFByZWxvYWRlZCByZWxhdGlvbnNoaXBzIHBlciBtb2RlbC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWwgPSBBcnJheS5mcm9tKHtsZW5ndGg6IG1vZGVscy5sZW5ndGh9LCAoKSA9PiAoe30pKVxuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxhdGlvbnNoaXAgZW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2xvYWRlZE1vZGVsczogaW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdFtdLCBtb2RlbEluZGV4OiBudW1iZXIsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzID0gW11cbiAgICAvKipcbiAgICAgKiBTaW5ndWxhciByZWxhdGlvbnNoaXAgZW50cmllcy5cbiAgICAgKiBAdHlwZSB7QXJyYXk8e2xvYWRlZE1vZGVsOiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0LCBtb2RlbEluZGV4OiBudW1iZXIsIHJlbGF0aW9uc2hpcE5hbWU6IHN0cmluZ30+fSAqL1xuICAgIGNvbnN0IHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcyA9IFtdXG5cbiAgICBtb2RlbHMuZm9yRWFjaCgobW9kZWwsIG1vZGVsSW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAobW9kZWwuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBzTWFwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5fc2VyaWFsaXphdGlvblJlc291cmNlSW5zdGFuY2VGb3JNb2RlbChtb2RlbClcbiAgICAgIGNvbnN0IHJlc291cmNlQ29uZmlndXJhdGlvbiA9IHJlc291cmNlID8gcmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uKCkgOiBudWxsXG4gICAgICBjb25zdCBleHBvc2VkUmVsYXRpb25zaGlwcyA9IG5ldyBTZXQoXG4gICAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbiAmJiBBcnJheS5pc0FycmF5KHJlc291cmNlQ29uZmlndXJhdGlvbi5yZWxhdGlvbnNoaXBzKVxuICAgICAgICAgID8gcmVzb3VyY2VDb25maWd1cmF0aW9uLnJlbGF0aW9uc2hpcHNcbiAgICAgICAgICA6IFtdXG4gICAgICApXG5cbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiByZWxhdGlvbnNoaXBzTWFwKSB7XG4gICAgICAgIGlmICghZXhwb3NlZFJlbGF0aW9uc2hpcHMuaGFzKHJlbGF0aW9uc2hpcE5hbWUpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuXG4gICAgICAgIGlmICghcmVsYXRpb25zaGlwLmdldFByZWxvYWRlZCgpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGxvYWRlZFJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZFJlbGF0aW9uc2hpcCkpIHtcbiAgICAgICAgICBjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcy5wdXNoKHtsb2FkZWRNb2RlbHM6IGxvYWRlZFJlbGF0aW9uc2hpcCwgbW9kZWxJbmRleCwgcmVsYXRpb25zaGlwTmFtZX0pXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLmlzU2VyaWFsaXphYmxlRnJvbnRlbmRNb2RlbChsb2FkZWRSZWxhdGlvbnNoaXApKSB7XG4gICAgICAgICAgc2luZ3VsYXJSZWxhdGlvbnNoaXBFbnRyaWVzLnB1c2goe2xvYWRlZE1vZGVsOiBsb2FkZWRSZWxhdGlvbnNoaXAsIG1vZGVsSW5kZXgsIHJlbGF0aW9uc2hpcE5hbWV9KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbbW9kZWxJbmRleF1bcmVsYXRpb25zaGlwTmFtZV0gPSBsb2FkZWRSZWxhdGlvbnNoaXAgPT0gdW5kZWZpbmVkID8gbnVsbCA6IGxvYWRlZFJlbGF0aW9uc2hpcFxuICAgICAgfVxuICAgIH0pXG5cbiAgICBpZiAoY29sbGVjdGlvblJlbGF0aW9uc2hpcEVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYWxsQ29sbGVjdGlvbk1vZGVscyA9IGNvbGxlY3Rpb25SZWxhdGlvbnNoaXBFbnRyaWVzLmZsYXRNYXAoKGVudHJ5KSA9PiBlbnRyeS5sb2FkZWRNb2RlbHMpXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmlsdGVyU2VyaWFsaXphYmxlUmVsYXRlZE1vZGVscyh7XG4gICAgICAgIG1vZGVsczogYWxsQ29sbGVjdGlvbk1vZGVscyxcbiAgICAgICAgcmVsYXRpb25zaGlwSXNDb2xsZWN0aW9uOiB0cnVlXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXphYmxlQ29sbGVjdGlvbk1vZGVsc1NldCA9IG5ldyBTZXQoc2VyaWFsaXphYmxlQ29sbGVjdGlvbk1vZGVscylcblxuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBFbnRyeSBvZiBjb2xsZWN0aW9uUmVsYXRpb25zaGlwRW50cmllcykge1xuICAgICAgICBjb25zdCBhbGxvd2VkTW9kZWxzID0gcmVsYXRpb25zaGlwRW50cnkubG9hZGVkTW9kZWxzLmZpbHRlcigocmVsYXRlZE1vZGVsKSA9PiBzZXJpYWxpemFibGVDb2xsZWN0aW9uTW9kZWxzU2V0LmhhcyhyZWxhdGVkTW9kZWwpKVxuICAgICAgICBjb25zdCBzZXJpYWxpemVkUmVsYXRlZE1vZGVscyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplRnJvbnRlbmRNb2RlbHMoYWxsb3dlZE1vZGVscylcblxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBzZXJpYWxpemVkUmVsYXRlZE1vZGVsc1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYWxsU2luZ3VsYXJNb2RlbHMgPSBzaW5ndWxhclJlbGF0aW9uc2hpcEVudHJpZXMubWFwKChlbnRyeSkgPT4gZW50cnkubG9hZGVkTW9kZWwpXG4gICAgICBjb25zdCBzZXJpYWxpemFibGVTaW5ndWxhck1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbHRlclNlcmlhbGl6YWJsZVJlbGF0ZWRNb2RlbHMoe1xuICAgICAgICBtb2RlbHM6IGFsbFNpbmd1bGFyTW9kZWxzLFxuICAgICAgICByZWxhdGlvbnNoaXBJc0NvbGxlY3Rpb246IGZhbHNlXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXphYmxlU2luZ3VsYXJNb2RlbHNTZXQgPSBuZXcgU2V0KHNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzKVxuXG4gICAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcEVudHJ5IG9mIHNpbmd1bGFyUmVsYXRpb25zaGlwRW50cmllcykge1xuICAgICAgICBpZiAoIXNlcmlhbGl6YWJsZVNpbmd1bGFyTW9kZWxzU2V0LmhhcyhyZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbCkpIHtcbiAgICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBudWxsXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IChhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxzKFtyZWxhdGlvbnNoaXBFbnRyeS5sb2FkZWRNb2RlbF0pKVswXVxuICAgICAgICBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzUGVyTW9kZWxbcmVsYXRpb25zaGlwRW50cnkubW9kZWxJbmRleF1bcmVsYXRpb25zaGlwRW50cnkucmVsYXRpb25zaGlwTmFtZV0gPSBzZXJpYWxpemVkTW9kZWxcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBTZXJpYWxpemVkIG1vZGVscy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W119ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZE1vZGVscyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IFttb2RlbEluZGV4LCBtb2RlbF0gb2YgbW9kZWxzLmVudHJpZXMoKSkge1xuICAgICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxBdHRyaWJ1dGVzKG1vZGVsKVxuICAgICAgY29uc3QgcHJlbG9hZGVkUmVsYXRpb25zaGlwcyA9IHByZWxvYWRlZFJlbGF0aW9uc2hpcHNQZXJNb2RlbFttb2RlbEluZGV4XVxuICAgICAgY29uc3QgYXNzb2NpYXRpb25Db3VudHMgPSBtb2RlbC5hc3NvY2lhdGlvbkNvdW50cygpXG4gICAgICBjb25zdCBxdWVyeURhdGFWYWx1ZXMgPSBtb2RlbC5xdWVyeURhdGFWYWx1ZXMoKVxuICAgICAgY29uc3QgY29tcHV0ZWRBYmlsaXRpZXMgPSBtb2RlbC5jb21wdXRlZEFiaWxpdGllcygpXG4gICAgICBjb25zdCBoYXNDb3VudHMgPSBPYmplY3Qua2V5cyhhc3NvY2lhdGlvbkNvdW50cykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzUXVlcnlEYXRhID0gT2JqZWN0LmtleXMocXVlcnlEYXRhVmFsdWVzKS5sZW5ndGggPiAwXG4gICAgICBjb25zdCBoYXNBYmlsaXRpZXMgPSBPYmplY3Qua2V5cyhjb21wdXRlZEFiaWxpdGllcykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgaGFzUHJlbG9hZGVkID0gT2JqZWN0LmtleXMocHJlbG9hZGVkUmVsYXRpb25zaGlwcykubGVuZ3RoID4gMFxuICAgICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLl9zZXJpYWxpemF0aW9uUmVzb3VyY2VJbnN0YW5jZUZvck1vZGVsKG1vZGVsKVxuICAgICAgY29uc3QgaGFzQXR0YWNobWVudE93bmVyID0gT2JqZWN0LmtleXMocmVzb3VyY2U/LnJlc291cmNlQ29uZmlndXJhdGlvbigpLmF0dGFjaG1lbnRzIHx8IHt9KS5sZW5ndGggPiAwXG5cbiAgICAgIGlmICghaGFzUHJlbG9hZGVkICYmICFoYXNDb3VudHMgJiYgIWhhc1F1ZXJ5RGF0YSAmJiAhaGFzQWJpbGl0aWVzICYmICFoYXNBdHRhY2htZW50T3duZXIpIHtcbiAgICAgICAgc2VyaWFsaXplZE1vZGVscy5wdXNoKHNlcmlhbGl6ZWRBdHRyaWJ1dGVzKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIFNlcmlhbGl6ZWQuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3Qgc2VyaWFsaXplZCA9IHsuLi5zZXJpYWxpemVkQXR0cmlidXRlc31cblxuICAgICAgaWYgKGhhc1ByZWxvYWRlZCkgc2VyaWFsaXplZC5fX3ByZWxvYWRlZFJlbGF0aW9uc2hpcHMgPSBwcmVsb2FkZWRSZWxhdGlvbnNoaXBzXG4gICAgICBpZiAoaGFzQ291bnRzKSBzZXJpYWxpemVkLl9fYXNzb2NpYXRpb25Db3VudHMgPSBhc3NvY2lhdGlvbkNvdW50c1xuICAgICAgaWYgKGhhc1F1ZXJ5RGF0YSkgc2VyaWFsaXplZC5fX3F1ZXJ5RGF0YSA9IHF1ZXJ5RGF0YVZhbHVlc1xuICAgICAgaWYgKGhhc0FiaWxpdGllcykgc2VyaWFsaXplZC5fX2FiaWxpdGllcyA9IGNvbXB1dGVkQWJpbGl0aWVzXG4gICAgICBpZiAoaGFzQXR0YWNobWVudE93bmVyKSB7XG4gICAgICAgIGlmICghcmVzb3VyY2UpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBmcm9udGVuZCBtb2RlbCByZXNvdXJjZSBmb3IgYXR0YWNobWVudCBvd25lciAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gICAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBtb2RlbC5nZXRNb2RlbENsYXNzKClcblxuICAgICAgICBzZXJpYWxpemVkW0FUVEFDSE1FTlRfT1dORVJfS0VZXSA9IHtcbiAgICAgICAgICByZWNvcmRJZDogbW9kZWxQcmltYXJ5S2V5Q2FjaGVLZXkobW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIG1vZGVsLmlkKCkpLFxuICAgICAgICAgIHJlY29yZFR5cGU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgICAgcmVzb3VyY2VOYW1lOiByZXNvdXJjZS5tb2RlbE5hbWUoKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHNlcmlhbGl6ZWRNb2RlbHMucHVzaChzZXJpYWxpemVkKVxuICAgIH1cblxuICAgIHJldHVybiBzZXJpYWxpemVkTW9kZWxzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXJpYWxpemUgZnJvbnRlbmQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWwgLSBGcm9udGVuZCBtb2RlbCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gU2VyaWFsaXplZCBmcm9udGVuZCBtb2RlbCBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplRnJvbnRlbmRNb2RlbChtb2RlbCkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbHMgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWxzKFttb2RlbF0pXG5cbiAgICByZXR1cm4gc2VyaWFsaXplZE1vZGVsc1swXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVuZGVyIGVycm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXJyb3JNZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBlcnJvciBoYXMgYmVlbiByZW5kZXJlZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxSZW5kZXJFcnJvcihlcnJvck1lc3NhZ2UpIHtcbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcihgRnJvbnRlbmQgbW9kZWwgcmVxdWVzdCBmYWlsZWQ6ICR7ZXJyb3JNZXNzYWdlfWApXG5cbiAgICBjb25zdCByZW5kZXJFcnJvciA9IC8qKiBAdHlwZSB7KChlcnJvck1lc3NhZ2U6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPikgfCB1bmRlZmluZWR9ICovIChcbiAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKS5yZW5kZXJFcnJvclxuICAgIClcblxuICAgIGlmICh0eXBlb2YgcmVuZGVyRXJyb3IgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgcmVuZGVyRXJyb3IuY2FsbCh0aGlzLCBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHtcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGVycm9yIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBlcnJvck1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIC0gU3RydWN0dXJlZCBlcnJvciBmaWVsZHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkNsaWVudEVycm9yUGF5bG9hZFJlcG9ydGVyUGF5bG9hZH0gW29wdGlvbnMuZGV0YWlsc10gLSBDbGllbnQtc2FmZSBkZXRhaWxzLlxuICAgKiBAcGFyYW0ge1wiYXBwbGljYXRpb25fZXJyb3JcIiB8IFwiYXV0aG9yaXphdGlvbl9lcnJvclwiIHwgXCJpbnRlcm5hbF9lcnJvclwiIHwgXCJyZWNvcmRfbm90X2ZvdW5kXCIgfCBcInZhbGlkYXRpb25fZXJyb3JcIn0gW29wdGlvbnMuZXJyb3JUeXBlXSAtIFN0YWJsZSBjbGllbnQtZmFjaW5nIGVycm9yIGNhdGVnb3J5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEVycm9yIHBheWxvYWQuXG4gICAqL1xuICBmcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGVycm9yTWVzc2FnZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLihvcHRpb25zLmRldGFpbHMgPyB7ZGV0YWlsczogb3B0aW9ucy5kZXRhaWxzfSA6IHt9KSxcbiAgICAgIGVycm9yTWVzc2FnZSxcbiAgICAgIC4uLihvcHRpb25zLmVycm9yVHlwZSA/IHtlcnJvclR5cGU6IG9wdGlvbnMuZXJyb3JUeXBlfSA6IHt9KSxcbiAgICAgIHN0YXR1czogXCJlcnJvclwiXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgY2xpZW50IHNhZmUgZXJyb3IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDbGllbnQtc2FmZSBlcnJvciBwYXlsb2FkLlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbENsaWVudFNhZmVFcnJvclBheWxvYWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChmcm9udGVuZE1vZGVsQ2xpZW50U2FmZUVycm9yTWVzc2FnZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgZnJvbnRlbmQtbW9kZWwgZW5kcG9pbnQgZXJyb3IgY29udGV4dCBmb3IgbG9nZ2luZyBhbmQgY2xpZW50IHBheWxvYWQgcmVwb3J0ZXJzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEVycm9yIGNvbnRleHQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWN0aW9uIC0gRW5kcG9pbnQvYWN0aW9uIGxhYmVsLlxuICAgKiBAcGFyYW0ge3Vua25vd259IGFyZ3MuZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCIgfCBcImN1c3RvbS1jb21tYW5kXCJ9IFthcmdzLmNvbW1hbmRUeXBlXSAtIEZyb250ZW5kLW1vZGVsIGNvbW1hbmQgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFthcmdzLm1vZGVsXSAtIFJlcXVlc3QgbW9kZWwgbmFtZSB3aGVuIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IFthcmdzLnJlcXVlc3RJZF0gLSBCYXRjaCByZXF1ZXN0IGlkIHdoZW4gYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0fSBGcm9udGVuZC1tb2RlbCBlbmRwb2ludCBlcnJvciBjb250ZXh0LlxuICAgKi9cbiAgZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHthY3Rpb24sIGNvbW1hbmRUeXBlLCBlcnJvciwgbW9kZWwsIHJlcXVlc3RJZH0pIHtcbiAgICBsZXQgcmVzb2x2ZWRNb2RlbCA9IG1vZGVsXG4gICAgY29uc3QgZXhwZWN0ZWRFcnJvciA9IGZyb250ZW5kTW9kZWxFeHBlY3RlZEVycm9yKGVycm9yKVxuXG4gICAgaWYgKCFyZXNvbHZlZE1vZGVsKSB7XG4gICAgICBjb25zdCBjYWNoZWRQYXJhbXMgPSB0aGlzLl9mcm9udGVuZE1vZGVsUGFyYW1zT3ZlcnJpZGUgfHwgdGhpcy5fZnJvbnRlbmRNb2RlbFBhcmFtc1xuICAgICAgY29uc3QgcGFyYW1zTW9kZWwgPSBjYWNoZWRQYXJhbXMgPyBjYWNoZWRQYXJhbXMubW9kZWwgOiB1bmRlZmluZWRcbiAgICAgIHJlc29sdmVkTW9kZWwgPSB0eXBlb2YgcGFyYW1zTW9kZWwgPT09IFwic3RyaW5nXCIgJiYgcGFyYW1zTW9kZWwubGVuZ3RoID4gMCA/IHBhcmFtc01vZGVsIDogdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdGlvbixcbiAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgY29udHJvbGxlcjogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgLi4uKGV4cGVjdGVkRXJyb3IgPyB7fSA6IHtjb3JyZWxhdGlvbklkOiByYW5kb21VVUlEKCl9KSxcbiAgICAgIGV4cGVjdGVkRXJyb3IsXG4gICAgICBmcm9udGVuZE1vZGVsRW5kcG9pbnQ6IHRydWUsXG4gICAgICBtb2RlbDogcmVzb2x2ZWRNb2RlbCxcbiAgICAgIHJlcXVlc3RJZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIG1vZGVsIGNsaWVudCBlcnJvciBwYXlsb2FkIGZvciBlcnJvci5cbiAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIENhdWdodCBlcnJvci5cbiAgICogQHBhcmFtIHtGcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQgfCB1bmRlZmluZWR9IFtlbmRwb2ludEVycm9yQ29udGV4dF0gLSBGcm9udGVuZC1tb2RlbCBlbmRwb2ludCBlcnJvciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQ2xpZW50RXJyb3JQYXlsb2FkUmVwb3J0ZXJQYXlsb2FkPn0gLSBDbGllbnQgcGF5bG9hZCBmb3IgdGhlIGN1cnJlbnQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVuZHBvaW50RXJyb3JDb250ZXh0KSB7XG4gICAgY29uc3QgdmVsb2Npb3VzTWV0YWRhdGEgPSBmcm9udGVuZE1vZGVsVmVsb2Npb3VzTWV0YWRhdGFGb3JFcnJvcihlcnJvcilcbiAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5DbGllbnRFcnJvclBheWxvYWRSZXBvcnRlclBheWxvYWR9ICovXG4gICAgY29uc3Qgc2FmZUVycm9yUGF5bG9hZCA9IHt9XG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICAgIGlmIChlcnJvci5lcnJvclR5cGUpIHNhZmVFcnJvclBheWxvYWQuZXJyb3JUeXBlID0gZXJyb3IuZXJyb3JUeXBlXG4gICAgICBpZiAoZXJyb3IuZGV0YWlscykgc2FmZUVycm9yUGF5bG9hZC5kZXRhaWxzID0gZXJyb3IuZGV0YWlsc1xuICAgIH0gZWxzZSBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZWNvcmROb3RGb3VuZEVycm9yKSB7XG4gICAgICBzYWZlRXJyb3JQYXlsb2FkLmVycm9yVHlwZSA9IFwicmVjb3JkX25vdF9mb3VuZFwiXG4gICAgfSBlbHNlIGlmICh2ZWxvY2lvdXNNZXRhZGF0YSkge1xuICAgICAgaWYgKHR5cGVvZiB2ZWxvY2lvdXNNZXRhZGF0YS5lcnJvclR5cGUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgc2FmZUVycm9yUGF5bG9hZC5lcnJvclR5cGUgPSB2ZWxvY2lvdXNNZXRhZGF0YS5lcnJvclR5cGVcbiAgICAgIH1cbiAgICAgIGlmIChpc1BsYWluT2JqZWN0KHZlbG9jaW91c01ldGFkYXRhLmRldGFpbHMpKSB7XG4gICAgICAgIHNhZmVFcnJvclBheWxvYWQuZGV0YWlscyA9IHZlbG9jaW91c01ldGFkYXRhLmRldGFpbHNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgdmFsaWRhdGlvbkVycm9yc1BheWxvYWQgPSB7fVxuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3JzID0gZXJyb3IuZ2V0VmFsaWRhdGlvbkVycm9ycygpXG4gICAgICBjb25zdCBtb2RlbCA9IGVycm9yLmdldE1vZGVsKClcbiAgICAgIC8qKlxuICAgICAgICogU3RydWN0dXJlZCBlcnJvcnMuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3R5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBmdWxsTWVzc2FnZTogc3RyaW5nfVtdPn0gKi9cbiAgICAgIGNvbnN0IHN0cnVjdHVyZWRFcnJvcnMgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdmFsaWRhdGlvbkVycm9ycykge1xuICAgICAgICBzdHJ1Y3R1cmVkRXJyb3JzW2F0dHJpYnV0ZU5hbWVdID0gdmFsaWRhdGlvbkVycm9yc1thdHRyaWJ1dGVOYW1lXS5tYXAoZXJyID0+ICh7XG4gICAgICAgICAgdHlwZTogZXJyLnR5cGUsXG4gICAgICAgICAgbWVzc2FnZTogZXJyLm1lc3NhZ2UsXG4gICAgICAgICAgZnVsbE1lc3NhZ2U6IGAke21vZGVsLmdldE1vZGVsQ2xhc3MoKS5odW1hbkF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSl9ICR7ZXJyLm1lc3NhZ2V9YFxuICAgICAgICB9KSlcbiAgICAgIH1cblxuICAgICAgdmFsaWRhdGlvbkVycm9yc1BheWxvYWQgPSB7XG4gICAgICAgIGVycm9yVHlwZTogXCJ2YWxpZGF0aW9uX2Vycm9yXCIsXG4gICAgICAgIHZhbGlkYXRpb25FcnJvcnM6IHN0cnVjdHVyZWRFcnJvcnNcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXBvcnRlclBheWxvYWQgPSBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5jbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcih7XG4gICAgICBjb250ZXh0OiBlbmRwb2ludEVycm9yQ29udGV4dCB8fCB7Y29udHJvbGxlcjogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSxcbiAgICAgIGVycm9yOiBub3JtYWxpemVkRXJyb3IsXG4gICAgICByZXF1ZXN0OiB0aGlzLmdldFJlcXVlc3QoKVxuICAgIH0pXG5cbiAgICBpZiAoIXRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEV4cG9zZUludGVybmFsRXJyb3JzVG9DbGllbnRzKCkpIHtcbiAgICAgIGRlbGV0ZSByZXBvcnRlclBheWxvYWQuZGVidWdCYWNrdHJhY2VcbiAgICAgIGRlbGV0ZSByZXBvcnRlclBheWxvYWQuZGVidWdFcnJvckNsYXNzXG4gICAgICBkZWxldGUgcmVwb3J0ZXJQYXlsb2FkLmRlYnVnRXJyb3JNZXNzYWdlXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnJlcG9ydGVyUGF5bG9hZCxcbiAgICAgIC4uLnRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChmcm9udGVuZE1vZGVsQ2xpZW50TWVzc2FnZUZvckVycm9yKFxuICAgICAgICBlcnJvcixcbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RXhwb3NlSW50ZXJuYWxFcnJvcnNUb0NsaWVudHMoKVxuICAgICAgKSksXG4gICAgICAuLi5mcm9udGVuZE1vZGVsRGVidWdQYXlsb2FkRm9yRXJyb3Ioe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgZXJyb3JcbiAgICAgIH0pLFxuICAgICAgLi4uKHZlbG9jaW91c01ldGFkYXRhID8ge3ZlbG9jaW91czogdmVsb2Npb3VzTWV0YWRhdGF9IDoge30pLFxuICAgICAgLi4uc2FmZUVycm9yUGF5bG9hZCxcbiAgICAgIC4uLnZhbGlkYXRpb25FcnJvcnNQYXlsb2FkLFxuICAgICAgLi4uKCFlbmRwb2ludEVycm9yQ29udGV4dD8uZXhwZWN0ZWRFcnJvciAmJiBlbmRwb2ludEVycm9yQ29udGV4dD8uY29ycmVsYXRpb25JZFxuICAgICAgICA/IHtjb3JyZWxhdGlvbklkOiBlbmRwb2ludEVycm9yQ29udGV4dC5jb3JyZWxhdGlvbklkLCBlcnJvclR5cGU6IFwiaW50ZXJuYWxfZXJyb3JcIn1cbiAgICAgICAgOiB7fSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBsb2cgZW5kcG9pbnQgZXJyb3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRXJyb3IgbG9nIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBDYXVnaHQgZXJyb3IuXG4gICAqIEBwYXJhbSB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0fSBhcmdzLmVycm9yQ29udGV4dCAtIFNoYXJlZCBjbGllbnQvbG9nZ2luZyBlcnJvciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBsb2dnaW5nLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KSB7XG4gICAgLy8gRXhwZWN0ZWQgdXNlci1mbG93IGVycm9ycyBhcmUgc3VyZmFjZWQgdG8gY2xpZW50cyBieVxuICAgIC8vIGZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvciwgYnV0IHNraXBwZWQgaGVyZSBzbyBtb25pdG9yaW5nXG4gICAgLy8gc3RheXMgZm9jdXNlZCBvbiByZWFsIGJhY2tlbmQgZmFpbHVyZXMuXG4gICAgaWYgKGVycm9yQ29udGV4dC5leHBlY3RlZEVycm9yKSByZXR1cm5cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHJlZGFjdG9yID0gY29uZmlndXJhdGlvbi5nZXRMb2dSZWRhY3RvcigpXG4gICAgY29uc3QgcmVxdWVzdFRpbWluZyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIGNvbnN0IHNlbnNpdGl2ZVZhbHVlcyA9IHJlcXVlc3RUaW1pbmcgPyByZXF1ZXN0VGltaW5nLmdldExvZ1NlbnNpdGl2ZVZhbHVlcygpIDogbmV3IFNldCgpXG4gICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG4gICAgY29uc3QgcmVkYWN0ZWRFcnJvciA9IHJlZGFjdG9yLnJlZGFjdEVycm9yKG5vcm1hbGl6ZWRFcnJvciwgc2Vuc2l0aXZlVmFsdWVzKVxuICAgIGNvbnN0IHJlZGFjdGVkQ29udGV4dCA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0fSAqLyAocmVkYWN0b3IucmVkYWN0U3RydWN0dXJlZChlcnJvckNvbnRleHQsIHNlbnNpdGl2ZVZhbHVlcykpXG5cbiAgICBhd2FpdCB0aGlzLmxvZ2dlci5lcnJvcigoKSA9PiBbXCJGcm9udGVuZCBtb2RlbCBlbmRwb2ludCByZXF1ZXN0IGZhaWxlZFwiLCB7XG4gICAgICBhY3Rpb246IHJlZGFjdGVkQ29udGV4dC5hY3Rpb24sXG4gICAgICBjb21tYW5kVHlwZTogcmVkYWN0ZWRDb250ZXh0LmNvbW1hbmRUeXBlLFxuICAgICAgY29ycmVsYXRpb25JZDogcmVkYWN0ZWRDb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICBlcnJvckJhY2t0cmFjZTogcmVkYWN0ZWRFcnJvci5zdGFjayxcbiAgICAgIGVycm9yQ2xhc3M6IHJlZGFjdGVkRXJyb3IubmFtZSxcbiAgICAgIGVycm9yTWVzc2FnZTogcmVkYWN0ZWRFcnJvci5tZXNzYWdlLFxuICAgICAgbW9kZWw6IHJlZGFjdGVkQ29udGV4dC5tb2RlbCxcbiAgICAgIHJlcXVlc3RJZDogcmVkYWN0ZWRDb250ZXh0LnJlcXVlc3RJZFxuICAgIH1dKVxuXG4gICAgLy8gU3VyZmFjZSBnZW51aW5lbHkgdW5leHBlY3RlZCBiYWNrZW5kIGZhaWx1cmVzIG9uIHRoZSBmcmFtZXdvcmstZXJyb3JcbiAgICAvLyBjaGFubmVsIHNvIHByb2Nlc3MtbGV2ZWwgYnVnIHJlcG9ydGVycyBjYXB0dXJlIHRoZW0sIGluc3RlYWQgb2YgdGhlXG4gICAgLy8gY29udHJvbGxlciBzaWxlbnRseSBzd2FsbG93aW5nIHRoZW0gYmVoaW5kIHRoZSBnZW5lcmljIFwiUmVxdWVzdFxuICAgIC8vIGZhaWxlZC5cIiBjbGllbnQgbWVzc2FnZS5cbiAgICBjb25zdCBlcnJvclBheWxvYWQgPSB7XG4gICAgICBjb3JyZWxhdGlvbklkOiByZWRhY3RlZENvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgIGNvbnRleHQ6IHJlZGFjdGVkQ29udGV4dCxcbiAgICAgIGVycm9yOiByZWRhY3RlZEVycm9yLFxuICAgICAgcmVxdWVzdDogdGhpcy5nZXRSZXF1ZXN0KCksXG4gICAgICByZXF1ZXN0RGV0YWlsczogcmVxdWVzdERldGFpbHModGhpcy5nZXRSZXF1ZXN0KCksIHtyZWRhY3Rvciwgc2Vuc2l0aXZlVmFsdWVzfSlcbiAgICB9XG5cbiAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFcnJvckV2ZW50cygpLmVtaXQoXCJmcmFtZXdvcmstZXJyb3JcIiwgZXJyb3JQYXlsb2FkKVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVycm9yRXZlbnRzKCkuZW1pdChcImFsbC1lcnJvclwiLCB7Li4uZXJyb3JQYXlsb2FkLCBlcnJvclR5cGU6IFwiZnJhbWV3b3JrLWVycm9yXCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgbW9kZWwgcmVuZGVyIGNvbW1hbmQgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiByZXNwb25zZSBoYXMgYmVlbiByZW5kZXJlZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoYWN0aW9uKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbW1hbmRQYXlsb2FkKGFjdGlvbilcbiAgICAgIGlmICghcmVzcG9uc2VQYXlsb2FkKSByZXR1cm5cblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXNwb25zZVBheWxvYWQsIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSB0aGlzLmZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCh7YWN0aW9uLCBjb21tYW5kVHlwZTogYWN0aW9uLCBlcnJvcn0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjb21tYW5kIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7XCJpbmRleFwiIHwgXCJmaW5kXCIgfCBcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwiIHwgXCJhdHRhY2hcIiB8IFwiYXR0YWNobWVudExpc3RcIiB8IFwiZG93bmxvYWRcIiB8IFwidXJsXCJ9IGFjdGlvbiAtIEZyb250ZW5kIGFjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gUmVzcG9uc2UgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZChhY3Rpb24pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUZyb250ZW5kTW9kZWxDbGFzc0luaXRpYWxpemVkKClcblxuICAgIGlmICghKGF3YWl0IHRoaXMucnVuRnJvbnRlbmRNb2RlbEJlZm9yZUFjdGlvbihhY3Rpb24pKSkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlSW5zdGFuY2UoKVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJpbmRleFwiKSB7XG4gICAgICBpZiAodGhpcy5mcm9udGVuZE1vZGVsQ291bnRSZXF1ZXN0ZWQoKSkge1xuICAgICAgICBpZiAoIShhd2FpdCByZXNvdXJjZS5zdXBwb3J0c0NvdW50KFwiaW5kZXhcIikpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY291bnQgaXMgbm90IHN1cHBvcnRlZCB3aGVuIHJlc291cmNlIHJlY29yZHMgYXJlIGN1c3RvbWl6ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY291bnQ6IGF3YWl0IHJlc291cmNlLmNvdW50KCksXG4gICAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBsdWNrID0gdGhpcy5mcm9udGVuZE1vZGVsUGx1Y2soKVxuXG4gICAgICBpZiAocGx1Y2subGVuZ3RoID4gMCkge1xuICAgICAgICBpZiAoIShhd2FpdCByZXNvdXJjZS5zdXBwb3J0c1BsdWNrKFwiaW5kZXhcIikpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicGx1Y2sgaXMgbm90IHN1cHBvcnRlZCB3aGVuIHJlc291cmNlIHJlY29yZHMgYXJlIGN1c3RvbWl6ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHZhbHVlcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFBsdWNrVmFsdWVzKHtcbiAgICAgICAgICBwbHVjayxcbiAgICAgICAgICBxdWVyeTogcmVzb3VyY2UuaW5kZXhRdWVyeSgpXG4gICAgICAgIH0pXG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiLFxuICAgICAgICAgIHZhbHVlc1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1vZGVscyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlY29yZHMoKVxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhtb2RlbHMpXG4gICAgICBjb25zdCBzZXJpYWxpemVkTW9kZWxzID0gYXdhaXQgUHJvbWlzZS5hbGwobW9kZWxzLm1hcChhc3luYyAobW9kZWwpID0+IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZShtb2RlbCwgXCJpbmRleFwiKSkpXG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIG1vZGVsczogc2VyaWFsaXplZE1vZGVscyxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZnJvbnRlbmRNb2RlbENsYXNzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5mcm9udGVuZE1vZGVsUHJpbWFyeUtleSgpXG4gICAgbGV0IGlkID0gcGFyYW1zLmlkXG5cbiAgICBpZiAoYWN0aW9uID09PSBcImNyZWF0ZVwiKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgbXV0YXRpb25BdHRyaWJ1dGVzID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKG11dGF0aW9uQXR0cmlidXRlcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDcmVhdGVSZWNvcmQoXG4gICAgICAgIG11dGF0aW9uQXR0cmlidXRlcy5hdHRyaWJ1dGVzLFxuICAgICAgICBtdXRhdGlvbkF0dHJpYnV0ZXMubmVzdGVkQXR0cmlidXRlcyxcbiAgICAgICAgbXV0YXRpb25BdHRyaWJ1dGVzLmF0dGFjaG1lbnRzXG4gICAgICApXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWRNb2RlbCA9IGF3YWl0IHJlc291cmNlLnNlcmlhbGl6ZShtb2RlbCwgXCJjcmVhdGVcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgJiYgKCh0eXBlb2YgaWQgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSB8fCBgJHtpZH1gLmxlbmd0aCA8IDEpKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgbW9kZWwgaWQuXCIsIHtlcnJvclR5cGU6IFwidmFsaWRhdGlvbl9lcnJvclwifSlcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkocHJpbWFyeUtleSkgJiYgdHlwZW9mIGlkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlkID0gbW9kZWxQcmltYXJ5S2V5VmFsdWVGcm9tQ2FjaGVLZXkocHJpbWFyeUtleSwgaWQpXG4gICAgICB9XG5cbiAgICAgIG1vZGVsUHJpbWFyeUtleUNvbmRpdGlvbnMocHJpbWFyeUtleSwgaWQpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgVHlwZUVycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChlcnJvci5tZXNzYWdlLCB7ZXJyb3JUeXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJhdHRhY2hcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudE5hbWUgPSBwYXJhbXMuYXR0YWNobWVudE5hbWVcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRJbnB1dCA9IHBhcmFtcy5hdHRhY2htZW50XG5cbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudE5hbWUgIT09IFwic3RyaW5nXCIgfHwgYXR0YWNobWVudE5hbWUubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgYXR0YWNobWVudE5hbWUuXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudElucHV0ID09PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCBhdHRhY2htZW50IGlucHV0LlwiKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJhdHRhY2hcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLmF0dGFjaChhdHRhY2htZW50SW5wdXQpXG4gICAgICBjb25zdCBzZXJpYWxpemVkTW9kZWwgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZUZyb250ZW5kTW9kZWwobW9kZWwpXG5cbiAgICAgIHJldHVybiBmcm9udGVuZE1vZGVsU2VyaWFsaXplZE1vZGVsU3VjY2VzcyhzZXJpYWxpemVkTW9kZWwpXG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJkb3dubG9hZFwiKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGFyYW1zID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKVxuICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50UGFyYW1zID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGF0dGFjaG1lbnRQYXJhbXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImRvd25sb2FkXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkb3dubG9hZGVkQXR0YWNobWVudCA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkuZG93bmxvYWQoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50SWQpXG5cbiAgICAgIGlmICghZG93bmxvYWRlZEF0dGFjaG1lbnQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkF0dGFjaG1lbnQgbm90IGZvdW5kLlwiLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGF0dGFjaG1lbnQ6IHtcbiAgICAgICAgICBieXRlU2l6ZTogZG93bmxvYWRlZEF0dGFjaG1lbnQuYnl0ZVNpemUoKSxcbiAgICAgICAgICBjb250ZW50QmFzZTY0OiBkb3dubG9hZGVkQXR0YWNobWVudC5jb250ZW50KCkudG9TdHJpbmcoXCJiYXNlNjRcIiksXG4gICAgICAgICAgY29udGVudFR5cGU6IGRvd25sb2FkZWRBdHRhY2htZW50LmNvbnRlbnRUeXBlKCksXG4gICAgICAgICAgZmlsZW5hbWU6IGRvd25sb2FkZWRBdHRhY2htZW50LmZpbGVuYW1lKCksXG4gICAgICAgICAgaWQ6IGRvd25sb2FkZWRBdHRhY2htZW50LmlkKCksXG4gICAgICAgICAgdXJsOiBkb3dubG9hZGVkQXR0YWNobWVudC51cmwoKVxuICAgICAgICB9LFxuICAgICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJ1cmxcIikge1xuICAgICAgY29uc3QgYXR0YWNobWVudFBhcmFtcyA9IGZyb250ZW5kTW9kZWxBdHRhY2htZW50UGFyYW1zKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgYXR0YWNobWVudFBhcmFtcyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChhdHRhY2htZW50UGFyYW1zKVxuXG4gICAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJ1cmxcIiwgaWQpXG5cbiAgICAgIGlmICghbW9kZWwpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVybCA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkudXJsKGF0dGFjaG1lbnRQYXJhbXMuYXR0YWNobWVudElkKVxuXG4gICAgICBpZiAoIXVybCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQXR0YWNobWVudCBVUkwgbm90IGF2YWlsYWJsZS5cIilcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgdXJsXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGFjdGlvbiA9PT0gXCJhdHRhY2htZW50TGlzdFwiKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50UGFyYW1zID0gZnJvbnRlbmRNb2RlbEF0dGFjaG1lbnRQYXJhbXMocGFyYW1zKVxuICAgICAgaWYgKHR5cGVvZiBhdHRhY2htZW50UGFyYW1zID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGF0dGFjaG1lbnRQYXJhbXMpXG5cbiAgICAgIGNvbnN0IG1vZGVsID0gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsRmluZFJlY29yZChcImF0dGFjaG1lbnRMaXN0XCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhdHRhY2htZW50cyA9IGF3YWl0IG1vZGVsLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudFBhcmFtcy5hdHRhY2htZW50TmFtZSkubGlzdE1ldGFkYXRhKClcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYXR0YWNobWVudHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYWN0aW9uID09PSBcImZpbmRcIikge1xuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwiZmluZFwiLCBpZClcblxuICAgICAgaWYgKCFtb2RlbCkge1xuICAgICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKGAke21vZGVsQ2xhc3MubmFtZX0gbm90IGZvdW5kLmAsIHtlcnJvclR5cGU6IFwicmVjb3JkX25vdF9mb3VuZFwifSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tcHV0ZUFiaWxpdGllcyhbbW9kZWxdKVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKG1vZGVsLCBcImZpbmRcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBpZiAoYWN0aW9uID09PSBcInVwZGF0ZVwiKSB7XG4gICAgICBjb25zdCBtdXRhdGlvbkF0dHJpYnV0ZXMgPSBmcm9udGVuZE1vZGVsTXV0YXRpb25BdHRyaWJ1dGVzKHBhcmFtcylcbiAgICAgIGlmICh0eXBlb2YgbXV0YXRpb25BdHRyaWJ1dGVzID09PSBcInN0cmluZ1wiKSByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKG11dGF0aW9uQXR0cmlidXRlcylcblxuICAgICAgY29uc3QgbW9kZWwgPSBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxGaW5kUmVjb3JkKFwidXBkYXRlXCIsIGlkKVxuXG4gICAgICBpZiAoIW1vZGVsKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoYCR7bW9kZWxDbGFzcy5uYW1lfSBub3QgZm91bmQuYCwge2Vycm9yVHlwZTogXCJyZWNvcmRfbm90X2ZvdW5kXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCB1cGRhdGVkTW9kZWwgPSBhd2FpdCByZXNvdXJjZS51cGRhdGUobW9kZWwsIG11dGF0aW9uQXR0cmlidXRlcy5hdHRyaWJ1dGVzLCB7XG4gICAgICAgIGF0dGFjaG1lbnRzOiBtdXRhdGlvbkF0dHJpYnV0ZXMuYXR0YWNobWVudHMsXG4gICAgICAgIGNvbnRyb2xsZXI6IHRoaXMsXG4gICAgICAgIG5lc3RlZEF0dHJpYnV0ZXM6IG11dGF0aW9uQXR0cmlidXRlcy5uZXN0ZWRBdHRyaWJ1dGVzXG4gICAgICB9KVxuICAgICAgY29uc3Qgc2VyaWFsaXplZE1vZGVsID0gYXdhaXQgcmVzb3VyY2Uuc2VyaWFsaXplKHVwZGF0ZWRNb2RlbCwgXCJ1cGRhdGVcIilcblxuICAgICAgcmV0dXJuIGZyb250ZW5kTW9kZWxTZXJpYWxpemVkTW9kZWxTdWNjZXNzKHNlcmlhbGl6ZWRNb2RlbClcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEZpbmRSZWNvcmQoXCJkZXN0cm95XCIsIGlkKVxuXG4gICAgaWYgKCFtb2RlbCkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgJHttb2RlbENsYXNzLm5hbWV9IG5vdCBmb3VuZC5gLCB7ZXJyb3JUeXBlOiBcInJlY29yZF9ub3RfZm91bmRcIn0pXG4gICAgfVxuXG4gICAgYXdhaXQgcmVzb3VyY2UuZGVzdHJveShtb2RlbClcblxuICAgIHJldHVybiB7c3RhdHVzOiBcInN1Y2Nlc3NcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgYm9vdHN0cmFwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIGJvb3RzdHJhcCByZXNwb25zZSB3aXRoIG1hbmlmZXN0IGFuZCBzaWduZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY0Jvb3RzdHJhcCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBzeW5jTWFuaWZlc3QgPSBmcm9udGVuZE1vZGVsU3luY01hbmlmZXN0Rm9yQmFja2VuZFByb2plY3RzKGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50ID0gYXdhaXQgY3JlYXRlT2ZmbGluZUdyYW50RnJvbUJvb3RzdHJhcCh7XG4gICAgICBkZXZpY2VJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBEZXZpY2VJZChwYXJhbXMpLFxuICAgICAgZ3JhbnRJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBHcmFudElkKHBhcmFtcyksXG4gICAgICBncmFudFR0bE1zOiBjb25maWd1cmF0aW9uLmdldFN5bmNDb25maWd1cmF0aW9uKCkub2ZmbGluZUdyYW50VHRsTXMsXG4gICAgICBub3c6IHRoaXMuZnJvbnRlbmRTeW5jQm9vdHN0cmFwTm93KHBhcmFtcyksXG4gICAgICByZXNvdXJjZXM6IHN5bmNNYW5pZmVzdCxcbiAgICAgIHNjb3BlczogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBTY29wZXMocGFyYW1zKSxcbiAgICAgIHNpZ25pbmdLZXk6IGNvbmZpZ3VyYXRpb24uY3VycmVudE9mZmxpbmVHcmFudFNpZ25pbmdLZXkoKSxcbiAgICAgIHVzZXJJZDogdGhpcy5mcm9udGVuZFN5bmNCb290c3RyYXBVc2VySWQoKVxuICAgIH0pXG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIG9mZmxpbmVHcmFudCxcbiAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgICAgc3luY01hbmlmZXN0XG4gICAgICB9LCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgZGV2aWNlIGlkIGZvciBzeW5jIGJvb3RzdHJhcC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBEZXZpY2UgaWQuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBEZXZpY2VJZChwYXJhbXMpIHtcbiAgICBpZiAodHlwZW9mIHBhcmFtcy5kZXZpY2VJZCA9PT0gXCJzdHJpbmdcIiAmJiBwYXJhbXMuZGV2aWNlSWQubGVuZ3RoID4gMCkgcmV0dXJuIHBhcmFtcy5kZXZpY2VJZFxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBib290c3RyYXAgZGV2aWNlSWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBncmFudCBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlIHwgdW5kZWZpbmVkPn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGV0ZXJtaW5pc3RpYyBncmFudCBpZCBmb3IgdGVzdHMsIGdlbmVyYXRlZCBpZCBvdGhlcndpc2UuXG4gICAqL1xuICBmcm9udGVuZFN5bmNCb290c3RyYXBHcmFudElkKHBhcmFtcykge1xuICAgIGlmICh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiAmJiB0eXBlb2YgcGFyYW1zLmdyYW50SWQgPT09IFwic3RyaW5nXCIpIHJldHVybiBwYXJhbXMuZ3JhbnRJZFxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGJvb3RzdHJhcCBpc3N1ZSB0aW1lLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZSB8IHVuZGVmaW5lZD59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7RGF0ZX0gLSBJc3N1ZSB0aW1lLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwTm93KHBhcmFtcykge1xuICAgIGlmICh0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudCgpID09PSBcInRlc3RcIiAmJiB0eXBlb2YgcGFyYW1zLm5vdyA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIG5ldyBEYXRlKHBhcmFtcy5ub3cpXG5cbiAgICByZXR1cm4gbmV3IERhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHN5bmMgYm9vdHN0cmFwIHNjb3Blcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWUgfCB1bmRlZmluZWQ+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gR3JhbnQgc2NvcGVzLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jQm9vdHN0cmFwU2NvcGVzKHBhcmFtcykge1xuICAgIGNvbnN0IHNjb3BlcyA9IHBhcmFtcy5zY29wZXNcblxuICAgIGlmIChzY29wZXMgJiYgdHlwZW9mIHNjb3BlcyA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShzY29wZXMpKSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoc2NvcGVzKVxuICAgIH1cblxuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGN1cnJlbnQgdXNlciBpZCBmb3Igc3luYyBib290c3RyYXAuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVXNlciBpZC5cbiAgICovXG4gIGZyb250ZW5kU3luY0Jvb3RzdHJhcFVzZXJJZCgpIHtcbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5jdXJyZW50QWJpbGl0eSgpXG4gICAgY29uc3QgY3VycmVudFVzZXIgPSBhYmlsaXR5Py5jdXJyZW50VXNlcigpXG5cbiAgICBpZiAodHlwZW9mIGN1cnJlbnRVc2VyID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBjdXJyZW50VXNlciA9PT0gXCJudW1iZXJcIikgcmV0dXJuIFN0cmluZyhjdXJyZW50VXNlcilcbiAgICBpZiAoY3VycmVudFVzZXIgJiYgdHlwZW9mIGN1cnJlbnRVc2VyID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBjb25zdCB1c2VyUmVjb3JkID0gLyoqIEB0eXBlIHt7aWQ/OiBzdHJpbmcgfCBudW1iZXIgfCAoKCkgPT4gc3RyaW5nIHwgbnVtYmVyKX19ICovIChjdXJyZW50VXNlcilcbiAgICAgIGNvbnN0IGlkVmFsdWUgPSB0eXBlb2YgdXNlclJlY29yZC5pZCA9PT0gXCJmdW5jdGlvblwiID8gdXNlclJlY29yZC5pZCgpIDogdXNlclJlY29yZC5pZFxuXG4gICAgICBpZiAodHlwZW9mIGlkVmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIGlkVmFsdWUgPT09IFwibnVtYmVyXCIpIHJldHVybiBTdHJpbmcoaWRWYWx1ZSlcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIGJvb3RzdHJhcCBjdXJyZW50IHVzZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgcmVwbGF5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBTeW5jIHJlcGxheSByZXNwb25zZSB3aXRoIHBlci1tdXRhdGlvbiByZXN1bHRzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5KCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3Qgc2lnbmVkTXV0YXRpb25zID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlTaWduZWRNdXRhdGlvbnMocGFyYW1zKVxuICAgIGNvbnN0IHJlc3VsdHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBzaWduZWRNdXRhdGlvbiBvZiBzaWduZWRNdXRhdGlvbnMpIHtcbiAgICAgIGxldCBpZGVtcG90ZW5jeUtleSA9IG51bGxcblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXkgPSBtdXRhdGlvbklkZW1wb3RlbmN5S2V5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbikpXG4gICAgICAgIGNvbnN0IHtyZXNwb25zZSwgc2VydmVyQ2hhbmdlRmVlZEVycm9yLCBzZXJ2ZXJDaGFuZ2VGZWVkU3RhdHVzLCBzZXJ2ZXJTZXF1ZW5jZX0gPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9uKHNpZ25lZE11dGF0aW9uKVxuXG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgc2VydmVyQ2hhbmdlRmVlZEVycm9yLFxuICAgICAgICAgIHNlcnZlckNoYW5nZUZlZWRTdGF0dXMsXG4gICAgICAgICAgc2VydmVyU2VxdWVuY2UsXG4gICAgICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIlxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICAgIGFjdGlvbjogXCJmcm9udGVuZFN5bmNSZXBsYXlcIixcbiAgICAgICAgICBjb21tYW5kVHlwZTogc2lnbmVkTXV0YXRpb24gJiYgdHlwZW9mIHNpZ25lZE11dGF0aW9uID09PSBcIm9iamVjdFwiICYmIFwibXV0YXRpb25cIiBpbiBzaWduZWRNdXRhdGlvblxuICAgICAgICAgICAgPyAvKiogQHR5cGUge3ttdXRhdGlvbj86IHtvcGVyYXRpb24/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19fSAqLyAoc2lnbmVkTXV0YXRpb24pLm11dGF0aW9uPy5vcGVyYXRpb25cbiAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIG1vZGVsOiBzaWduZWRNdXRhdGlvbiAmJiB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gPT09IFwib2JqZWN0XCIgJiYgXCJtdXRhdGlvblwiIGluIHNpZ25lZE11dGF0aW9uXG4gICAgICAgICAgICA/IC8qKiBAdHlwZSB7e211dGF0aW9uPzoge21vZGVsPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fX0gKi8gKHNpZ25lZE11dGF0aW9uKS5tdXRhdGlvbj8ubW9kZWxcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgIH0pXG5cbiAgICAgICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsTG9nRW5kcG9pbnRFcnJvcih7ZXJyb3IsIGVycm9yQ29udGV4dH0pXG5cbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpZGVtcG90ZW5jeUtleSxcbiAgICAgICAgICByZXNwb25zZTogYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ2xpZW50RXJyb3JQYXlsb2FkRm9yRXJyb3IoZXJyb3IsIGVycm9yQ29udGV4dCksXG4gICAgICAgICAgc3RhdHVzOiBcImVycm9yXCJcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh7XG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzaWduZWQgcmVwbGF5IG11dGF0aW9ucyBmcm9tIHJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gU2lnbmVkIG11dGF0aW9uIGVudmVsb3Blcy5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVNpZ25lZE11dGF0aW9ucyhwYXJhbXMpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJhbXMubXV0YXRpb25zKSkgcmV0dXJuIHBhcmFtcy5tdXRhdGlvbnNcbiAgICBpZiAocGFyYW1zLm11dGF0aW9uKSByZXR1cm4gW3BhcmFtcy5tdXRhdGlvbl1cblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgcmVwbGF5IG11dGF0aW9uIG9yIG11dGF0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGFuZCByZXBsYXlzIG9uZSBzaWduZWQgc3luYyBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc2lnbmVkTXV0YXRpb24gLSBTaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtyZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzZXJ2ZXJDaGFuZ2VGZWVkRXJyb3I/OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHNlcnZlckNoYW5nZUZlZWRTdGF0dXM/OiBcImVycm9yXCIsIHNlcnZlclNlcXVlbmNlOiBudW1iZXIgfCBudWxsfT59IC0gRnJvbnRlbmQtbW9kZWwgY29tbWFuZCByZXNwb25zZSBhbmQgYXBwZW5kZWQgc2VydmVyIHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkTXV0YXRpb24oc2lnbmVkTXV0YXRpb24pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBzeW5jQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24uZ2V0U3luY0NvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGJhY2tlbmRQdWJsaWNLZXkgPSBzeW5jQ29uZmlndXJhdGlvbi5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXlcblxuICAgIGlmICghYmFja2VuZFB1YmxpY0tleSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwic3luYy5kZXZpY2VDZXJ0aWZpY2F0ZUJhY2tlbmRQdWJsaWNLZXkgaXMgcmVxdWlyZWQgZm9yIHN5bmMgcmVwbGF5XCIpXG5cbiAgICBsZXQgbXV0YXRpb25cblxuICAgIHRyeSB7XG4gICAgICBtdXRhdGlvbiA9IGF3YWl0IHZlcmlmeVNpZ25lZE11dGF0aW9uKHtcbiAgICAgICAgYmFja2VuZFB1YmxpY0tleSxcbiAgICAgICAgc2lnbmVkTXV0YXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChzaWduZWRNdXRhdGlvbilcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksIGVycm9yKVxuICAgIH1cblxuICAgIGNvbnN0IHN5bmNNYW5pZmVzdCA9IGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHMoY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKSlcbiAgICBjb25zdCBzeW5jUmVzb3VyY2UgPSBzeW5jTWFuaWZlc3RbbXV0YXRpb24ubW9kZWxdXG5cbiAgICBpZiAoIXN5bmNSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIGlmICghc3luY1Jlc291cmNlLm9wZXJhdGlvbnMuaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBvcGVyYXRpb24gaXMgbm90IGVuYWJsZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cbiAgICBpZiAoc3luY1Jlc291cmNlLnBvbGljeUhhc2ggIT09IG11dGF0aW9uLnBvbGljeUhhc2gpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgcG9saWN5IGhhc2ggbWlzbWF0Y2ggZm9yICR7bXV0YXRpb24ubW9kZWx9YClcbiAgICB9XG5cbiAgICBjb25zdCBzaWduZWRPZmZsaW5lR3JhbnQgPSB0aGlzLmZyb250ZW5kU3luY1JlcGxheVNpZ25lZE9mZmxpbmVHcmFudChzaWduZWRNdXRhdGlvbilcbiAgICBjb25zdCBvZmZsaW5lR3JhbnQgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtcbiAgICAgIHNpZ25lZE9mZmxpbmVHcmFudCxcbiAgICAgIHNpZ25pbmdLZXlzOiBzeW5jQ29uZmlndXJhdGlvbi5vZmZsaW5lR3JhbnRTaWduaW5nS2V5c1xuICAgIH0pXG5cbiAgICB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZhbGlkYXRlT2ZmbGluZUdyYW50KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jUmVzb3VyY2V9KVxuXG4gICAgY29uc3QgY29tbWFuZFBhcmFtcyA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZFBhcmFtcyhtdXRhdGlvbilcbiAgICBjb25zdCByZXBsYXlDb21tYW5kID0gdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kRm9yTXV0YXRpb24obXV0YXRpb24pXG5cbiAgICBsZXQgcmVzcG9uc2VcblxuICAgIHRyeSB7XG4gICAgICByZXNwb25zZSA9IGF3YWl0IHRoaXMud2l0aEZyb250ZW5kTW9kZWxQYXJhbXMoY29tbWFuZFBhcmFtcywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbW1hbmRQYXJhbXMsIHRoaXMucmVzcG9uc2UoKSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChbXCJjcmVhdGVcIiwgXCJ1cGRhdGVcIiwgXCJkZXN0cm95XCJdLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDb21tYW5kUGF5bG9hZCgvKiogQHR5cGUge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9ICovIChtdXRhdGlvbi5vcGVyYXRpb24pKSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDdXN0b21Db21tYW5kUGF5bG9hZCh7bXV0YXRpb24sIHJlcGxheUNvbW1hbmR9KSB8fCB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJBY3Rpb24gaGFsdGVkIGJ5IGJlZm9yZUFjdGlvbi5cIilcbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVycm9yQ29udGV4dCA9IHRoaXMuZnJvbnRlbmRNb2RlbEVuZHBvaW50RXJyb3JDb250ZXh0KHtcbiAgICAgICAgYWN0aW9uOiBcImZyb250ZW5kU3luY1JlcGxheVwiLFxuICAgICAgICBjb21tYW5kVHlwZTogLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlcGxheUNvbW1hbmQuY29tbWFuZFR5cGUpLFxuICAgICAgICBlcnJvcixcbiAgICAgICAgbW9kZWw6IG11dGF0aW9uLm1vZGVsXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxMb2dFbmRwb2ludEVycm9yKHtlcnJvciwgZXJyb3JDb250ZXh0fSlcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVzcG9uc2U6IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLFxuICAgICAgICBzZXJ2ZXJTZXF1ZW5jZTogbnVsbFxuICAgICAgfVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZSA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jQXBwZW5kU2VydmVyQ2hhbmdlKHtcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IG11dGF0aW9uSWRlbXBvdGVuY3lLZXkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlNpZ25lZFN5bmNNdXRhdGlvbn0gKi8gKHNpZ25lZE11dGF0aW9uKSksXG4gICAgICAgIG11dGF0aW9uLFxuICAgICAgICBvZmZsaW5lR3JhbnQsXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4ge3Jlc3BvbnNlLCBzZXJ2ZXJTZXF1ZW5jZX1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICBhY3Rpb246IFwiZnJvbnRlbmRTeW5jUmVwbGF5XCIsXG4gICAgICAgIGNvbW1hbmRUeXBlOiAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVwbGF5Q29tbWFuZC5jb21tYW5kVHlwZSksXG4gICAgICAgIGVycm9yLFxuICAgICAgICBtb2RlbDogbXV0YXRpb24ubW9kZWxcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICByZXNwb25zZSxcbiAgICAgICAgc2VydmVyQ2hhbmdlRmVlZEVycm9yOiBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxDbGllbnRFcnJvclBheWxvYWRGb3JFcnJvcihlcnJvciwgZXJyb3JDb250ZXh0KSxcbiAgICAgICAgc2VydmVyQ2hhbmdlRmVlZFN0YXR1czogXCJlcnJvclwiLFxuICAgICAgICBzZXJ2ZXJTZXF1ZW5jZTogbnVsbFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc2lnbmVkIG9mZmxpbmUgZ3JhbnQgY2FycmllZCBieSBhIHJlcGxheSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzaWduZWRNdXRhdGlvbiAtIFNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICAgKi9cbiAgZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkT2ZmbGluZUdyYW50KHNpZ25lZE11dGF0aW9uKSB7XG4gICAgaWYgKCFzaWduZWRNdXRhdGlvbiB8fCB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzaWduZWRNdXRhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIkV4cGVjdGVkIHN5bmMgcmVwbGF5IHNpZ25lZCBvZmZsaW5lIGdyYW50XCIpXG4gICAgfVxuXG4gICAgY29uc3Qgc2lnbmVkTXV0YXRpb25SZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNpZ25lZE11dGF0aW9uKVxuICAgIGNvbnN0IHNpZ25lZE9mZmxpbmVHcmFudCA9IHNpZ25lZE11dGF0aW9uUmVjb3JkLnNpZ25lZE9mZmxpbmVHcmFudCB8fCBzaWduZWRNdXRhdGlvblJlY29yZC5vZmZsaW5lR3JhbnQgfHwgc2lnbmVkTXV0YXRpb25SZWNvcmQuc2lnbmVkR3JhbnRcblxuICAgIGlmICghc2lnbmVkT2ZmbGluZUdyYW50KSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJFeHBlY3RlZCBzeW5jIHJlcGxheSBzaWduZWQgb2ZmbGluZSBncmFudFwiKVxuXG4gICAgcmV0dXJuIHNpZ25lZE9mZmxpbmVHcmFudFxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIGEgc3luYyByZXBsYXkgc2lnbmVkIG9mZmxpbmUgZ3JhbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnNpZ25lZE9mZmxpbmVHcmFudCAtIFNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudFNpZ25pbmdLZXlbXX0gYXJncy5zaWduaW5nS2V5cyAtIEF2YWlsYWJsZSBzaWduaW5nIGtleXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vc3luYy9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudD59IC0gVmVyaWZpZWQgb2ZmbGluZSBncmFudC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtzaWduZWRPZmZsaW5lR3JhbnQsIHNpZ25pbmdLZXlzfSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdmVyaWZ5T2ZmbGluZUdyYW50KHtcbiAgICAgICAgbm93OiBuZXcgRGF0ZSgpLFxuICAgICAgICBzaWduZWRHcmFudDogLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5TaWduZWRPZmZsaW5lR3JhbnR9ICovIChzaWduZWRPZmZsaW5lR3JhbnQpLFxuICAgICAgICBzaWduaW5nS2V5c1xuICAgICAgfSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSwgZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyB0aGF0IGEgdmVyaWZpZWQgb2ZmbGluZSBncmFudCBhdXRob3JpemVzIGEgcmVwbGF5ZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50fSBhcmdzLm9mZmxpbmVHcmFudCAtIFZlcmlmaWVkIGdyYW50LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5zeW5jUmVzb3VyY2UgLSBDdXJyZW50IHN5bmMgcmVzb3VyY2UgZW50cnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIFRocm93cyB3aGVuIHVuYXV0aG9yaXplZC5cbiAgICovXG4gIGZyb250ZW5kU3luY1JlcGxheVZhbGlkYXRlT2ZmbGluZUdyYW50KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jUmVzb3VyY2V9KSB7XG4gICAgaWYgKG9mZmxpbmVHcmFudC5ncmFudElkICE9PSBtdXRhdGlvbi5vZmZsaW5lR3JhbnRJZCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKFwiU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cbiAgICBpZiAob2ZmbGluZUdyYW50LmRldmljZUlkICE9PSBtdXRhdGlvbi5hY3RvckRldmljZUlkKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IGRldmljZSBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cbiAgICBpZiAob2ZmbGluZUdyYW50LnVzZXJJZCAhPT0gbXV0YXRpb24uYWN0b3JVc2VySWQpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihcIlN5bmMgcmVwbGF5IG9mZmxpbmUgZ3JhbnQgdXNlciBkb2VzIG5vdCBtYXRjaCBtdXRhdGlvblwiKVxuICAgIH1cblxuICAgIGNvbnN0IGdyYW50UmVzb3VyY2UgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gKi8gKG9mZmxpbmVHcmFudC5yZXNvdXJjZXNbbXV0YXRpb24ubW9kZWxdKVxuICAgIGNvbnN0IGdyYW50T3BlcmF0aW9ucyA9IEFycmF5LmlzQXJyYXkoZ3JhbnRSZXNvdXJjZT8ub3BlcmF0aW9ucykgPyBncmFudFJlc291cmNlLm9wZXJhdGlvbnMgOiBbXVxuICAgIGNvbnN0IGdyYW50UG9saWN5SGFzaCA9IGdyYW50UmVzb3VyY2U/LnBvbGljeUhhc2hcblxuICAgIGlmICghZ3JhbnRSZXNvdXJjZSB8fCBncmFudFJlc291cmNlLmVuYWJsZWQgIT09IHRydWUpIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH1gKVxuICAgIGlmICghZ3JhbnRPcGVyYXRpb25zLmluY2x1ZGVzKG11dGF0aW9uLm9wZXJhdGlvbikpIHtcbiAgICAgIHRocm93IGZyb250ZW5kU3luY1JlcGxheVNhZmVFcnJvcihgU3luYyByZXBsYXkgb2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH06ICR7bXV0YXRpb24ub3BlcmF0aW9ufWApXG4gICAgfVxuICAgIGlmIChncmFudFBvbGljeUhhc2ggIT09IG11dGF0aW9uLnBvbGljeUhhc2ggfHwgZ3JhbnRQb2xpY3lIYXNoICE9PSBzeW5jUmVzb3VyY2UucG9saWN5SGFzaCkge1xuICAgICAgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHBvbGljeSBoYXNoIG1pc21hdGNoIGZvciAke211dGF0aW9uLm1vZGVsfWApXG4gICAgfVxuICAgIGlmICghb2ZmbGluZUdyYW50LnNjb3BlcyB8fCB0eXBlb2Ygb2ZmbGluZUdyYW50LnNjb3BlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG9mZmxpbmVHcmFudC5zY29wZXMpKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoXCJTeW5jIHJlcGxheSBvZmZsaW5lIGdyYW50IHNjb3BlcyBhcmUgaW52YWxpZFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIGEgdmVyaWZpZWQgY3VzdG9tIHN5bmMgbXV0YXRpb24gdGhyb3VnaCB0aGUgcmVzb3VyY2UgY29tbWFuZCBBUEkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7e2NvbW1hbmRUeXBlOiBzdHJpbmcsIG1ldGhvZE5hbWU/OiBzdHJpbmcsIHNjb3BlPzogXCJjb2xsZWN0aW9uXCIgfCBcIm1lbWJlclwifX0gYXJncy5yZXBsYXlDb21tYW5kIC0gUmVzb2x2ZWQgcmVwbGF5IGNvbW1hbmQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gQ29tbWFuZCByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVwbGF5Q3VzdG9tQ29tbWFuZFBheWxvYWQoe211dGF0aW9uLCByZXBsYXlDb21tYW5kfSkge1xuICAgIGlmICh0eXBlb2YgcmVwbGF5Q29tbWFuZC5tZXRob2ROYW1lICE9PSBcInN0cmluZ1wiIHx8IHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZS5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IGNvbW1hbmQgaXMgbm90IHJlZ2lzdGVyZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn1gKVxuICAgIH1cblxuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICAubWFwKChiYWNrZW5kUHJvamVjdCkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IG11dGF0aW9uLm1vZGVsfSkpXG4gICAgICAuZmluZCgocmVzb3VyY2VDb25maWd1cmF0aW9uKSA9PiByZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgdGhyb3cgZnJvbnRlbmRTeW5jUmVwbGF5U2FmZUVycm9yKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH1gKVxuXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IoZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ2xhc3MpXG4gICAgY29uc3QgcmVzb3VyY2UgPSBuZXcgUmVzb3VyY2VDbGFzcyh7XG4gICAgICBhYmlsaXR5OiB0aGlzLmN1cnJlbnRBYmlsaXR5KCksXG4gICAgICBjb250cm9sbGVyOiB0aGlzLFxuICAgICAgY29udGV4dDoge1xuICAgICAgICAuLi4odGhpcy5jdXJyZW50QWJpbGl0eSgpPy5nZXRDb250ZXh0KCkgfHwge30pLFxuICAgICAgICBwYXJhbXM6IHRoaXMuZnJvbnRlbmRNb2RlbFBhcmFtcygpLFxuICAgICAgICByZXF1ZXN0OiB0aGlzLnJlcXVlc3QoKVxuICAgICAgfSxcbiAgICAgIGxvY2FsczogdGhpcy5jdXJyZW50QWJpbGl0eSgpPy5nZXRMb2NhbHMoKSB8fCB7fSxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMuZnJvbnRlbmRNb2RlbFJlc291cmNlTW9kZWxDbGFzcyhmcm9udGVuZE1vZGVsUmVzb3VyY2UpLFxuICAgICAgbW9kZWxOYW1lOiBmcm9udGVuZE1vZGVsUmVzb3VyY2UubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiB0aGlzLmZyb250ZW5kTW9kZWxQYXJhbXMoKSxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvblxuICAgIH0pXG4gICAgY29uc3QgY29tbWFuZCA9IHJlc291cmNlLnJlc291cmNlTWV0aG9kKHJlcGxheUNvbW1hbmQubWV0aG9kTmFtZSlcblxuICAgIGlmICghY29tbWFuZCkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgTWlzc2luZyBmcm9udGVuZC1tb2RlbCBjdXN0b20gY29tbWFuZCAnJHtyZXBsYXlDb21tYW5kLm1ldGhvZE5hbWV9Jy5gKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmRBcmd1bWVudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKG11dGF0aW9uLnBheWxvYWQgJiYgdHlwZW9mIG11dGF0aW9uLnBheWxvYWQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkobXV0YXRpb24ucGF5bG9hZCkgPyBtdXRhdGlvbi5wYXlsb2FkIDoge30pXG4gICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gYXdhaXQgY29tbWFuZC5tZXRob2QuY2FsbChjb21tYW5kLnJlc291cmNlLCBjb21tYW5kQXJndW1lbnRzKVxuXG4gICAgaWYgKCFyZXNwb25zZVBheWxvYWQgfHwgdHlwZW9mIHJlc3BvbnNlUGF5bG9hZCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIHtzdGF0dXM6IFwic3VjY2Vzc1wifVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKFxuICAgICAgYXdhaXQgdGhpcy5hdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQoXG4gICAgICAgIHJlc3BvbnNlUGF5bG9hZCxcbiAgICAgICAgLyoqIEB0eXBlIHt7c2VyaWFsaXplOiAobW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY3Rpb246IHN0cmluZykgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fX0gKi8gKGNvbW1hbmQucmVzb3VyY2UpLFxuICAgICAgICByZXBsYXlDb21tYW5kLm1ldGhvZE5hbWVcbiAgICAgIClcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGZyb250ZW5kLW1vZGVsIGNvbW1hbmQgcGFyYW1zIGZvciBhIHZlcmlmaWVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBWZXJpZmllZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBGcm9udGVuZC1tb2RlbCBjb21tYW5kIHBhcmFtcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1JlcGxheUNvbW1hbmRQYXJhbXMobXV0YXRpb24pIHtcbiAgICBjb25zdCBwYXlsb2FkID0gbXV0YXRpb24ucGF5bG9hZCAmJiB0eXBlb2YgbXV0YXRpb24ucGF5bG9hZCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShtdXRhdGlvbi5wYXlsb2FkKSA/IG11dGF0aW9uLnBheWxvYWQgOiB7fVxuICAgIGNvbnN0IHthdHRyaWJ1dGVzLCBwcmltYXJ5S2V5VmFsdWV9ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kQXR0cmlidXRlcyhtdXRhdGlvbilcbiAgICBjb25zdCBjb21tYW5kUGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7XG4gICAgICAuLi5wYXlsb2FkLFxuICAgICAgYXR0cmlidXRlcyxcbiAgICAgIG1vZGVsOiBtdXRhdGlvbi5tb2RlbFxuICAgIH0pXG5cbiAgICBpZiAoW1wiY3JlYXRlXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXS5pbmNsdWRlcyhtdXRhdGlvbi5vcGVyYXRpb24pKSB7XG4gICAgICBpZiAobXV0YXRpb24ub3BlcmF0aW9uICE9PSBcImNyZWF0ZVwiKSB7XG4gICAgICAgIGNvbnN0IGlkID0gY29tbWFuZFBhcmFtcy5pZCB8fCBjb21tYW5kUGFyYW1zLnJlY29yZElkIHx8IHByaW1hcnlLZXlWYWx1ZVxuXG4gICAgICAgIGlmICh0eXBlb2YgaWQgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5ICR7bXV0YXRpb24ub3BlcmF0aW9ufSByZXF1aXJlcyBhbiBpZGApXG5cbiAgICAgICAgY29tbWFuZFBhcmFtcy5pZCA9IGlkXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb21tYW5kUGFyYW1zXG4gICAgfVxuXG4gICAgY29uc3QgcmVwbGF5Q29tbWFuZCA9IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5Q29tbWFuZEZvck11dGF0aW9uKG11dGF0aW9uKVxuXG4gICAgY29tbWFuZFBhcmFtcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZE1ldGhvZE5hbWUgPSByZXBsYXlDb21tYW5kLm1ldGhvZE5hbWVcbiAgICBjb21tYW5kUGFyYW1zLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kU2NvcGUgPSByZXBsYXlDb21tYW5kLnNjb3BlXG5cbiAgICBpZiAocmVwbGF5Q29tbWFuZC5zY29wZSA9PT0gXCJtZW1iZXJcIikge1xuICAgICAgY29uc3QgaWQgPSBjb21tYW5kUGFyYW1zLmlkIHx8IGNvbW1hbmRQYXJhbXMucmVjb3JkSWQgfHwgcHJpbWFyeUtleVZhbHVlXG5cbiAgICAgIGlmICh0eXBlb2YgaWQgIT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGlkICE9PSBcIm51bWJlclwiKSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5ICR7bXV0YXRpb24ub3BlcmF0aW9ufSByZXF1aXJlcyBhbiBpZGApXG5cbiAgICAgIGNvbW1hbmRQYXJhbXMuaWQgPSBpZFxuICAgIH1cblxuICAgIHJldHVybiBjb21tYW5kUGFyYW1zXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGZyb250ZW5kLW1vZGVsIGNvbW1hbmQgdXNlZCBmb3IgYSB2ZXJpZmllZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IG11dGF0aW9uIC0gVmVyaWZpZWQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHt7Y29tbWFuZFR5cGU6IHN0cmluZywgbWV0aG9kTmFtZT86IHN0cmluZywgc2NvcGU/OiBcImNvbGxlY3Rpb25cIiB8IFwibWVtYmVyXCJ9fSAtIENvbW1hbmQgbWV0YWRhdGEuXG4gICAqL1xuICBmcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kRm9yTXV0YXRpb24obXV0YXRpb24pIHtcbiAgICBpZiAoW1wiY3JlYXRlXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiXS5pbmNsdWRlcyhtdXRhdGlvbi5vcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm4ge2NvbW1hbmRUeXBlOiBtdXRhdGlvbi5vcGVyYXRpb259XG4gICAgfVxuXG4gICAgY29uc3QgZnJvbnRlbmRNb2RlbFJlc291cmNlID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKClcbiAgICAgIC5tYXAoKGJhY2tlbmRQcm9qZWN0KSA9PiB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb25Gb3JCYWNrZW5kUHJvamVjdE1vZGVsTmFtZSh7YmFja2VuZFByb2plY3QsIG1vZGVsTmFtZTogbXV0YXRpb24ubW9kZWx9KSlcbiAgICAgIC5maW5kKChyZXNvdXJjZUNvbmZpZ3VyYXRpb24pID0+IHJlc291cmNlQ29uZmlndXJhdGlvbilcblxuICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlKSB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IG1vZGVsIGlzIG5vdCBlbmFibGVkOiAke211dGF0aW9uLm1vZGVsfWApXG5cbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IHR5cGVvZiBtdXRhdGlvbi5jb21tYW5kID09PSBcInN0cmluZ1wiICYmIG11dGF0aW9uLmNvbW1hbmQubGVuZ3RoID4gMCA/IG11dGF0aW9uLmNvbW1hbmQgOiBtdXRhdGlvbi5vcGVyYXRpb25cbiAgICBjb25zdCByZXNvdXJjZUNvbmZpZ3VyYXRpb24gPSBmcm9udGVuZE1vZGVsUmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uXG5cbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHJlc291cmNlQ29uZmlndXJhdGlvbi5jb2xsZWN0aW9uQ29tbWFuZHMsIGNvbW1hbmROYW1lKSkge1xuICAgICAgcmV0dXJuIHtjb21tYW5kVHlwZTogY29tbWFuZE5hbWUsIG1ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCBzY29wZTogXCJjb2xsZWN0aW9uXCJ9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChyZXNvdXJjZUNvbmZpZ3VyYXRpb24ubWVtYmVyQ29tbWFuZHMsIGNvbW1hbmROYW1lKSkge1xuICAgICAgcmV0dXJuIHtjb21tYW5kVHlwZTogY29tbWFuZE5hbWUsIG1ldGhvZE5hbWU6IGNvbW1hbmROYW1lLCBzY29wZTogXCJtZW1iZXJcIn1cbiAgICB9XG5cbiAgICB0aHJvdyBmcm9udGVuZFN5bmNSZXBsYXlTYWZlRXJyb3IoYFN5bmMgcmVwbGF5IGNvbW1hbmQgaXMgbm90IHJlZ2lzdGVyZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke2NvbW1hbmROYW1lfWApXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgY29tbWFuZCBhdHRyaWJ1dGVzIGFuZCBwcmltYXJ5IGtleSBmcm9tIGEgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSBtdXRhdGlvbiAtIFZlcmlmaWVkIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBwcmltYXJ5S2V5VmFsdWU6IHN0cmluZyB8IG51bWJlciB8IHVuZGVmaW5lZH0+fSAtIENvbW1hbmQgYXR0cmlidXRlcyBhbmQgcHJpbWFyeSBrZXkgdmFsdWUuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNSZXBsYXlDb21tYW5kQXR0cmlidXRlcyhtdXRhdGlvbikge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHsuLi4obXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSl9KVxuICAgIGNvbnN0IGZyb250ZW5kTW9kZWxSZXNvdXJjZSA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEJhY2tlbmRQcm9qZWN0cygpXG4gICAgICAubWFwKChiYWNrZW5kUHJvamVjdCkgPT4gdGhpcy5mcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uRm9yQmFja2VuZFByb2plY3RNb2RlbE5hbWUoe2JhY2tlbmRQcm9qZWN0LCBtb2RlbE5hbWU6IG11dGF0aW9uLm1vZGVsfSkpXG4gICAgICAuZmluZCgocmVzb3VyY2VDb25maWd1cmF0aW9uKSA9PiByZXNvdXJjZUNvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIWZyb250ZW5kTW9kZWxSZXNvdXJjZSkgcmV0dXJuIHthdHRyaWJ1dGVzLCBwcmltYXJ5S2V5VmFsdWU6IHVuZGVmaW5lZH1cblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0eXBlb2YgZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5ID09PSBcInN0cmluZ1wiID8gZnJvbnRlbmRNb2RlbFJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvbi5wcmltYXJ5S2V5IDogXCJpZFwiXG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZSA9IGF0dHJpYnV0ZXNbcHJpbWFyeUtleV1cbiAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWUgPSB0eXBlb2YgcHJpbWFyeUtleUF0dHJpYnV0ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgcHJpbWFyeUtleUF0dHJpYnV0ZSA9PT0gXCJudW1iZXJcIiA/IHByaW1hcnlLZXlBdHRyaWJ1dGUgOiB1bmRlZmluZWRcblxuICAgIGlmIChwcmltYXJ5S2V5VmFsdWUgIT09IHVuZGVmaW5lZCAmJiBtdXRhdGlvbi5vcGVyYXRpb24gIT09IFwiY3JlYXRlXCIpIGRlbGV0ZSBhdHRyaWJ1dGVzW3ByaW1hcnlLZXldXG5cbiAgICByZXR1cm4ge2F0dHJpYnV0ZXMsIHByaW1hcnlLZXlWYWx1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBlbmRzIGEgc3VjY2Vzc2Z1bGx5IHJlcGxheWVkIG11dGF0aW9uIHRvIHRoZSBzZXJ2ZXIgY2hhbmdlIGZlZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bGx9IGFyZ3MuaWRlbXBvdGVuY3lLZXkgLSBNdXRhdGlvbiBpZGVtcG90ZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBWZXJpZmllZCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMvb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnR9IGFyZ3Mub2ZmbGluZUdyYW50IC0gVmVyaWZpZWQgb2ZmbGluZSBncmFudC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MucmVzcG9uc2UgLSBSZXBsYXkgY29tbWFuZCByZXNwb25zZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgbnVsbD59IC0gQXNzaWduZWQgc2VydmVyIHNlcXVlbmNlLCBvciBudWxsIHdoZW4gbm8gY2hhbmdlIHdhcyBhcHBlbmRlZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY0FwcGVuZFNlcnZlckNoYW5nZSh7aWRlbXBvdGVuY3lLZXksIG11dGF0aW9uLCBvZmZsaW5lR3JhbnQsIHJlc3BvbnNlfSkge1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgIT09IFwic3VjY2Vzc1wiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc3RvcmUgPSBzZXJ2ZXJDaGFuZ2VGZWVkU3RvcmVGb3JDb25maWd1cmF0aW9uKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIGNvbnN0IHJlc3BvbnNlU3luY0NoYW5nZXMgPSBBcnJheS5pc0FycmF5KHJlc3BvbnNlLnN5bmNDaGFuZ2VzKSA/IHJlc3BvbnNlLnN5bmNDaGFuZ2VzIDogW11cbiAgICBjb25zdCBzeW5jQ2hhbmdlcyA9IHJlc3BvbnNlU3luY0NoYW5nZXMubGVuZ3RoID4gMCA/IHJlc3BvbnNlU3luY0NoYW5nZXMgOiBbe1xuICAgICAgYXR0cmlidXRlczogbXV0YXRpb24uYXR0cmlidXRlcyxcbiAgICAgIG1vZGVsOiBtdXRhdGlvbi5tb2RlbCxcbiAgICAgIG9wZXJhdGlvbjogbXV0YXRpb24ub3BlcmF0aW9uLFxuICAgICAgcGF5bG9hZDogbXV0YXRpb24ucGF5bG9hZFxuICAgIH1dXG4gICAgbGV0IHNlcnZlclNlcXVlbmNlID0gLyoqIEB0eXBlIHtudW1iZXIgfCBudWxsfSAqLyAobnVsbClcblxuICAgIGZvciAoY29uc3Qgc3luY0NoYW5nZSBvZiBzeW5jQ2hhbmdlcykge1xuICAgICAgaWYgKCFzeW5jQ2hhbmdlIHx8IHR5cGVvZiBzeW5jQ2hhbmdlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc3luY0NoYW5nZSkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNoYW5nZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc3luY0NoYW5nZSlcbiAgICAgIGNvbnN0IHBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGNoYW5nZS5wYXlsb2FkICYmIHR5cGVvZiBjaGFuZ2UucGF5bG9hZCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShjaGFuZ2UucGF5bG9hZCkgPyBjaGFuZ2UucGF5bG9hZCA6IHt9KVxuICAgICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoY2hhbmdlLmF0dHJpYnV0ZXMgJiYgdHlwZW9mIGNoYW5nZS5hdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGNoYW5nZS5hdHRyaWJ1dGVzKSA/IGNoYW5nZS5hdHRyaWJ1dGVzIDoge30pXG4gICAgICBjb25zdCBtb2RlbCA9IHR5cGVvZiBjaGFuZ2UubW9kZWwgPT09IFwic3RyaW5nXCIgJiYgY2hhbmdlLm1vZGVsLmxlbmd0aCA+IDAgPyBjaGFuZ2UubW9kZWwgOiBtdXRhdGlvbi5tb2RlbFxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gdHlwZW9mIGNoYW5nZS5vcGVyYXRpb24gPT09IFwic3RyaW5nXCIgJiYgY2hhbmdlLm9wZXJhdGlvbi5sZW5ndGggPiAwID8gY2hhbmdlLm9wZXJhdGlvbiA6IG11dGF0aW9uLm9wZXJhdGlvblxuICAgICAgY29uc3QgcmF3UmVjb3JkSWQgPSBjaGFuZ2UucmVjb3JkSWQgPz8gcGF5bG9hZC5pZCA/PyBwYXlsb2FkLnJlY29yZElkID8/IGF0dHJpYnV0ZXMuaWQgPz8gbnVsbFxuICAgICAgY29uc3QgcmVjb3JkSWQgPSByYXdSZWNvcmRJZCA9PT0gbnVsbCB8fCByYXdSZWNvcmRJZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhyYXdSZWNvcmRJZClcbiAgICAgIGNvbnN0IGFwcGVuZGVkQ2hhbmdlID0gYXdhaXQgc3RvcmUuYXBwZW5kKHtcbiAgICAgICAgYWN0b3JEZXZpY2VJZDogbXV0YXRpb24uYWN0b3JEZXZpY2VJZCxcbiAgICAgICAgYWN0b3JVc2VySWQ6IG11dGF0aW9uLmFjdG9yVXNlcklkLFxuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBpZGVtcG90ZW5jeUtleSxcbiAgICAgICAgbW9kZWwsXG4gICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgcmVjb3JkSWQsXG4gICAgICAgIHJlc3BvbnNlLFxuICAgICAgICBzY29wZTogb2ZmbGluZUdyYW50LnNjb3Blc1xuICAgICAgfSlcblxuICAgICAgc2VydmVyU2VxdWVuY2UgPSBhcHBlbmRlZENoYW5nZS5zZXJ2ZXJTZXF1ZW5jZVxuICAgIH1cblxuICAgIHJldHVybiBzZXJ2ZXJTZXF1ZW5jZVxuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmaWVzIHRoZSBzaWduZWQgb2ZmbGluZSBncmFudCB1c2VkIHRvIHNjb3BlIHN5bmMgcmVhZCBlbmRwb2ludHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9zeW5jL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50Pn0gLSBWZXJpZmllZCBvZmZsaW5lIGdyYW50LlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRTeW5jUmVxdWVzdFZlcmlmaWVkT2ZmbGluZUdyYW50KHBhcmFtcykge1xuICAgIGNvbnN0IHNpZ25lZE9mZmxpbmVHcmFudCA9IHRoaXMuZnJvbnRlbmRTeW5jUmVwbGF5U2lnbmVkT2ZmbGluZUdyYW50KHBhcmFtcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1JlcGxheVZlcmlmaWVkT2ZmbGluZUdyYW50KHtcbiAgICAgIHNpZ25lZE9mZmxpbmVHcmFudCxcbiAgICAgIHNpZ25pbmdLZXlzOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRTeW5jQ29uZmlndXJhdGlvbigpLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgY2hhbmdlIGZlZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFN5bmMgY2hhbmdlLWZlZWQgcmVzcG9uc2UuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNDaGFuZ2VGZWVkKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZGVzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUodGhpcy5wYXJhbXMoKSkpXG4gICAgY29uc3Qgb2ZmbGluZUdyYW50ID0gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNSZXF1ZXN0VmVyaWZpZWRPZmZsaW5lR3JhbnQocGFyYW1zKVxuICAgIGNvbnN0IGFmdGVyU2VxdWVuY2UgPSB0aGlzLmZyb250ZW5kU3luY0NoYW5nZUZlZWRBZnRlclNlcXVlbmNlKHBhcmFtcylcbiAgICBjb25zdCBzdG9yZSA9IHNlcnZlckNoYW5nZUZlZWRTdG9yZUZvckNvbmZpZ3VyYXRpb24odGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgY29uc3QgbGltaXQgPSB0aGlzLmZyb250ZW5kU3luY0NoYW5nZUZlZWRMaW1pdChwYXJhbXMpXG4gICAgY29uc3QgY3VycmVudFNlcnZlclNlcXVlbmNlID0gYXdhaXQgc3RvcmUubGF0ZXN0U2VxdWVuY2UoKVxuICAgIGNvbnN0IHNlcnZlclNlcXVlbmNlID0gdGhpcy5mcm9udGVuZFN5bmNDaGFuZ2VGZWVkVXBUb1NlcXVlbmNlKHBhcmFtcywgY3VycmVudFNlcnZlclNlcXVlbmNlKVxuICAgIGNvbnN0IHBhZ2UgPSBhd2FpdCBzdG9yZS5jaGFuZ2VzQWZ0ZXIoe2FmdGVyU2VxdWVuY2UsIGxpbWl0LCBzY29wZTogb2ZmbGluZUdyYW50LnNjb3BlcywgdXBUb1NlcXVlbmNlOiBzZXJ2ZXJTZXF1ZW5jZX0pXG5cbiAgICBpZiAocGFnZS5zbmFwc2hvdFJlcXVpcmVkKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHtcbiAgICAgICAgICBjaGFuZ2VzOiBbXSxcbiAgICAgICAgICBvbGRlc3RTZXF1ZW5jZTogcGFnZS5vbGRlc3RTZXF1ZW5jZSxcbiAgICAgICAgICByZXF1ZXN0ZWRBZnRlclNlcXVlbmNlOiBhZnRlclNlcXVlbmNlLFxuICAgICAgICAgIHNlcnZlclNlcXVlbmNlLFxuICAgICAgICAgIHNuYXBzaG90OiBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1NuYXBzaG90UGF5bG9hZCh7c2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXMsIHNlcnZlclNlcXVlbmNlfSksXG4gICAgICAgICAgc3RhdHVzOiBcInNuYXBzaG90X3JlcXVpcmVkXCJcbiAgICAgICAgfSwgdGhpcy50cmFuc3BvcnRTZXJpYWxpemF0aW9uT3B0aW9ucygpKSlcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjaGFuZ2VzID0gcGFnZS5jaGFuZ2VzXG4gICAgY29uc3QgaW5jbHVkZVNuYXBzaG90ID0gcGFyYW1zLnNuYXBzaG90ID09PSB0cnVlIHx8IHBhcmFtcy5pbmNsdWRlU25hcHNob3QgPT09IHRydWUgfHwgYWZ0ZXJTZXF1ZW5jZSA9PT0gMFxuICAgIGNvbnN0IHNuYXBzaG90ID0gaW5jbHVkZVNuYXBzaG90ID8gYXdhaXQgdGhpcy5mcm9udGVuZFN5bmNTbmFwc2hvdFBheWxvYWQoe3Njb3BlOiBvZmZsaW5lR3JhbnQuc2NvcGVzLCBzZXJ2ZXJTZXF1ZW5jZX0pIDogdW5kZWZpbmVkXG5cbiAgICBjb25zdCBwYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7XG4gICAgICBjaGFuZ2VzLFxuICAgICAgaGFzTW9yZTogcGFnZS5oYXNNb3JlLFxuICAgICAgbmV4dFNlcXVlbmNlOiBwYWdlLm5leHRTZXF1ZW5jZSxcbiAgICAgIHNlcnZlclNlcXVlbmNlLFxuICAgICAgc3RhdHVzOiBcInN1Y2Nlc3NcIixcbiAgICAgIHVwVG9TZXF1ZW5jZTogcGFnZS51cFRvU2VxdWVuY2VcbiAgICB9KVxuXG4gICAgaWYgKHNuYXBzaG90KSBwYXlsb2FkLnNuYXBzaG90ID0gc25hcHNob3RcblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHBheWxvYWQsIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzeW5jIGNoYW5nZS1mZWVkIGN1cnNvci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEV4Y2x1c2l2ZSBsb3dlci1ib3VuZCBzZXF1ZW5jZS5cbiAgICovXG4gIGZyb250ZW5kU3luY0NoYW5nZUZlZWRBZnRlclNlcXVlbmNlKHBhcmFtcykge1xuICAgIGNvbnN0IGFmdGVyU2VxdWVuY2UgPSBwYXJhbXMuYWZ0ZXJTZXF1ZW5jZSA/PyBwYXJhbXMuY3Vyc29yID8/IDBcblxuICAgIGlmICh0eXBlb2YgYWZ0ZXJTZXF1ZW5jZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKGFmdGVyU2VxdWVuY2UpICYmIGFmdGVyU2VxdWVuY2UgPj0gMCkgcmV0dXJuIGFmdGVyU2VxdWVuY2VcbiAgICBpZiAodHlwZW9mIGFmdGVyU2VxdWVuY2UgPT09IFwic3RyaW5nXCIgJiYgL15cXGQrJC8udGVzdChhZnRlclNlcXVlbmNlKSkgcmV0dXJuIE51bWJlcihhZnRlclNlcXVlbmNlKVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBjaGFuZ2UtZmVlZCBhZnRlclNlcXVlbmNlXCIpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgc3luYyBjaGFuZ2UtZmVlZCBwYWdlIGxpbWl0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUGFnZSBsaW1pdC5cbiAgICovXG4gIGZyb250ZW5kU3luY0NoYW5nZUZlZWRMaW1pdChwYXJhbXMpIHtcbiAgICBjb25zdCBsaW1pdCA9IHBhcmFtcy5saW1pdCA/PyBwYXJhbXMucGFnZVNpemUgPz8gMTAwXG5cbiAgICBpZiAodHlwZW9mIGxpbWl0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIobGltaXQpICYmIGxpbWl0ID4gMCkgcmV0dXJuIGxpbWl0XG4gICAgaWYgKHR5cGVvZiBsaW1pdCA9PT0gXCJzdHJpbmdcIiAmJiAvXlxcZCskLy50ZXN0KGxpbWl0KSkgcmV0dXJuIE51bWJlcihsaW1pdClcblxuICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHN5bmMgY2hhbmdlLWZlZWQgcG9zaXRpdmUgbGltaXRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBzeW5jIGNoYW5nZS1mZWVkIHN0YWJsZSBoaWdoLXdhdGVyIG1hcmsuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSAtIEN1cnJlbnQgbGF0ZXN0IHNlcnZlciBzZXF1ZW5jZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBJbmNsdXNpdmUgdXBwZXItYm91bmQgc2VxdWVuY2UuXG4gICAqL1xuICBmcm9udGVuZFN5bmNDaGFuZ2VGZWVkVXBUb1NlcXVlbmNlKHBhcmFtcywgY3VycmVudFNlcnZlclNlcXVlbmNlKSB7XG4gICAgY29uc3QgdXBUb1NlcXVlbmNlID0gcGFyYW1zLnVwVG9TZXF1ZW5jZSA/PyBwYXJhbXMuc2VydmVyU2VxdWVuY2UgPz8gY3VycmVudFNlcnZlclNlcXVlbmNlXG5cbiAgICBpZiAodHlwZW9mIHVwVG9TZXF1ZW5jZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNJbnRlZ2VyKHVwVG9TZXF1ZW5jZSkgJiYgdXBUb1NlcXVlbmNlID49IDApIHJldHVybiBNYXRoLm1pbih1cFRvU2VxdWVuY2UsIGN1cnJlbnRTZXJ2ZXJTZXF1ZW5jZSlcbiAgICBpZiAodHlwZW9mIHVwVG9TZXF1ZW5jZSA9PT0gXCJzdHJpbmdcIiAmJiAvXlxcZCskLy50ZXN0KHVwVG9TZXF1ZW5jZSkpIHJldHVybiBNYXRoLm1pbihOdW1iZXIodXBUb1NlcXVlbmNlKSwgY3VycmVudFNlcnZlclNlcXVlbmNlKVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgc3luYyBjaGFuZ2UtZmVlZCB1cFRvU2VxdWVuY2VcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHN5bmMgc25hcHNob3QgZW5kcG9pbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFN5bmMgc25hcHNob3QgcmVzcG9uc2UuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFN5bmNTbmFwc2hvdCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXJhbXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGRlc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHRoaXMucGFyYW1zKCkpKVxuICAgIGNvbnN0IG9mZmxpbmVHcmFudCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRTeW5jUmVxdWVzdFZlcmlmaWVkT2ZmbGluZUdyYW50KHBhcmFtcylcbiAgICBjb25zdCBzdG9yZSA9IHNlcnZlckNoYW5nZUZlZWRTdG9yZUZvckNvbmZpZ3VyYXRpb24odGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgY29uc3Qgc2VydmVyU2VxdWVuY2UgPSBhd2FpdCBzdG9yZS5sYXRlc3RTZXF1ZW5jZSgpXG4gICAgY29uc3Qgc25hcHNob3QgPSBhd2FpdCB0aGlzLmZyb250ZW5kU3luY1NuYXBzaG90UGF5bG9hZCh7c2NvcGU6IG9mZmxpbmVHcmFudC5zY29wZXMsIHNlcnZlclNlcXVlbmNlfSlcblxuICAgIGF3YWl0IHRoaXMucmVuZGVyKHtcbiAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKHtcbiAgICAgICAgc25hcHNob3QsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzbmFwc2hvdCBvZiBzeW5jLWVuYWJsZWQgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzIGF0IGEgc3RhYmxlIHNlcnZlciBzZXF1ZW5jZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnNlcnZlclNlcXVlbmNlIC0gU25hcHNob3Qgc2VxdWVuY2UuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5zY29wZV0gLSBDYWxsZXIgc3luYyBzY29wZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3Jlc291cmNlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzZXJ2ZXJTZXF1ZW5jZTogbnVtYmVyfT59IC0gU25hcHNob3QgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kU3luY1NuYXBzaG90UGF5bG9hZCh7c2NvcGUsIHNlcnZlclNlcXVlbmNlfSkge1xuICAgIGNvbnN0IHN5bmNNYW5pZmVzdCA9IGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHModGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0QmFja2VuZFByb2plY3RzKCkpXG4gICAgY29uc3QgcmVzb3VyY2VzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh7fSlcblxuICAgIGZvciAoY29uc3QgbW9kZWxOYW1lIG9mIE9iamVjdC5rZXlzKHN5bmNNYW5pZmVzdCkuc29ydCgpKSB7XG4gICAgICBjb25zdCBjb21tYW5kUGFyYW1zID0gey4uLihzY29wZSB8fCB7fSksIG1vZGVsOiBtb2RlbE5hbWV9XG5cbiAgICAgIHJlc291cmNlc1ttb2RlbE5hbWVdID0gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFBhcmFtcyhjb21tYW5kUGFyYW1zLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLndpdGhGcm9udGVuZE1vZGVsUmVxdWVzdENvbnRleHQoY29tbWFuZFBhcmFtcywgdGhpcy5yZXNwb25zZSgpLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENvbW1hbmRQYXlsb2FkKFwiaW5kZXhcIikgfHwgdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiQWN0aW9uIGhhbHRlZCBieSBiZWZvcmVBY3Rpb24uXCIpXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB7cmVzb3VyY2VzLCBzZXJ2ZXJTZXF1ZW5jZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGFwaS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gU2hhcmVkIGZyb250ZW5kIG1vZGVsIEFQSSBhY3Rpb24gd2l0aCBiYXRjaCBzdXBwb3J0LlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRBcGkoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGFyYW1zID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChkZXNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZSh0aGlzLnBhcmFtcygpKSlcbiAgICBjb25zdCByZXF1ZXN0cyA9IEFycmF5LmlzQXJyYXkocGFyYW1zLnJlcXVlc3RzKSA/IHBhcmFtcy5yZXF1ZXN0cyA6IFtwYXJhbXNdXG4gICAgLyoqXG4gICAgICogUmVzcG9uc2VzLlxuICAgICAqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IHJlc3BvbnNlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJlcXVlc3RFbnRyeSBvZiByZXF1ZXN0cykge1xuICAgICAgY29uc3QgY29tbWFuZFR5cGUgPSByZXF1ZXN0RW50cnk/LmNvbW1hbmRUeXBlXG4gICAgICBjb25zdCBjdXN0b21QYXRoID0gcmVxdWVzdEVudHJ5Py5jdXN0b21QYXRoXG4gICAgICBjb25zdCBtb2RlbCA9IHJlcXVlc3RFbnRyeT8ubW9kZWxcbiAgICAgIGNvbnN0IHBheWxvYWQgPSByZXF1ZXN0RW50cnk/LnBheWxvYWRcbiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlcXVlc3RFbnRyeT8ucmVxdWVzdElkXG5cbiAgICAgIGlmICh0eXBlb2YgbW9kZWwgIT09IFwic3RyaW5nXCIgfHwgbW9kZWwubGVuZ3RoIDwgMSkge1xuICAgICAgICByZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIHJlc3BvbnNlOiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCByZXF1ZXN0IG1vZGVsLlwiKVxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0J1aWx0SW5Db21tYW5kID0gW1wiaW5kZXhcIiwgXCJmaW5kXCIsIFwiY3JlYXRlXCIsIFwidXBkYXRlXCIsIFwiZGVzdHJveVwiLCBcImF0dGFjaFwiLCBcImRvd25sb2FkXCIsIFwidXJsXCIsIFwiYXR0YWNobWVudExpc3RcIl0uaW5jbHVkZXMoY29tbWFuZFR5cGUpXG5cbiAgICAgIGlmICghaXNCdWlsdEluQ29tbWFuZCAmJiAodHlwZW9mIGN1c3RvbVBhdGggIT09IFwic3RyaW5nXCIgfHwgIWN1c3RvbVBhdGguc3RhcnRzV2l0aChcIi9cIikpKSB7XG4gICAgICAgIHJlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVzcG9uc2U6IHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkV4cGVjdGVkIHJlcXVlc3QgY3VzdG9tUGF0aC5cIilcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVxdWVzdENvbnRleHQgPSBjYXB0dXJlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KHJlcXVlc3RFbnRyeT8ucmVxdWVzdENvbnRleHQpXG4gICAgICAgIGxldCByZXNwb25zZVBheWxvYWRcblxuICAgICAgICBpZiAoaXNCdWlsdEluQ29tbWFuZCkge1xuICAgICAgICAgIGNvbnN0IGNvbW1hbmRQYXJhbXMgPSBtZXJnZUZyb250ZW5kTW9kZWxSZW1vdGVSZXF1ZXN0Q29udGV4dChcbiAgICAgICAgICAgIHJlcXVlc3RDb250ZXh0LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICAuLi4ocGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIiA/IHBheWxvYWQgOiB7fSksXG4gICAgICAgICAgICAgIG1vZGVsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgKVxuXG4gICAgICAgICAgcmVzcG9uc2VQYXlsb2FkID0gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFBhcmFtcyhjb21tYW5kUGFyYW1zLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbW1hbmRQYXJhbXMsIHRoaXMucmVzcG9uc2UoKSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsQ29tbWFuZFBheWxvYWQoY29tbWFuZFR5cGUpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzcG9uc2VQYXlsb2FkID0gYXdhaXQgdGhpcy5mcm9udGVuZEFwaUN1c3RvbUNvbW1hbmRQYXlsb2FkKHtcbiAgICAgICAgICAgIGN1c3RvbVBhdGgsXG4gICAgICAgICAgICBwYXlsb2FkLFxuICAgICAgICAgICAgcmVxdWVzdENvbnRleHRcbiAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXNwb25zZTogcmVzcG9uc2VQYXlsb2FkIHx8IHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChcIkFjdGlvbiBoYWx0ZWQgYnkgYmVmb3JlQWN0aW9uLlwiKVxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3JDb250ZXh0ID0gdGhpcy5mcm9udGVuZE1vZGVsRW5kcG9pbnRFcnJvckNvbnRleHQoe1xuICAgICAgICAgIGFjdGlvbjogXCJmcm9udGVuZEFwaVwiLFxuICAgICAgICAgIGNvbW1hbmRUeXBlLFxuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIG1vZGVsLFxuICAgICAgICAgIHJlcXVlc3RJZFxuICAgICAgICB9KVxuXG4gICAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICAgIHJlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVzcG9uc2U6IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAganNvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzZXJpYWxpemVGcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWUoe1xuICAgICAgICByZXNwb25zZXMsXG4gICAgICAgIHN0YXR1czogXCJzdWNjZXNzXCJcbiAgICAgIH0sIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwYXRjaGVzIGEgY3VzdG9tIGZyb250ZW5kLW1vZGVsIGNvbW1hbmQgdGhyb3VnaCB0aGUgc2hhcmVkIGZyb250ZW5kLW1vZGVsIEFQSSBlbmRwb2ludC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmN1c3RvbVBhdGggLSBDdXN0b20gYmFja2VuZCByb3V0ZSBwYXRoLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnBheWxvYWQgLSBSZXF1ZXN0IHBheWxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZW1vdGUtcmVxdWVzdC1jb250ZXh0LmpzXCIpLlJlbW90ZVJlcXVlc3RDb250ZXh0fSBhcmdzLnJlcXVlc3RDb250ZXh0IC0gQ2FwdHVyZWQgcmVtb3RlIHJlcXVlc3QgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBQYXJzZWQgSlNPTiByZXNwb25zZSBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRBcGlDdXN0b21Db21tYW5kUGF5bG9hZCh7Y3VzdG9tUGF0aCwgcGF5bG9hZCwgcmVxdWVzdENvbnRleHR9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBuZXcgUmVzcG9uc2Uoe2NvbmZpZ3VyYXRpb259KVxuICAgIGNvbnN0IHJlc29sdmVyID0gbmV3IFJvdXRlc1Jlc29sdmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICByZXF1ZXN0OiB0aGlzLmdldFJlcXVlc3QoKSxcbiAgICAgIHJlc3BvbnNlXG4gICAgfSlcbiAgICByZXNvbHZlci5wYXJhbXMgPSB7fVxuICAgIGNvbnN0IHJvdXRlSG9va01hdGNoID0gYXdhaXQgcmVzb2x2ZXIucmVzb2x2ZVJvdXRlUmVzb2x2ZXJIb29rcyhjdXN0b21QYXRoKVxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25Sb3V0ZXMgPSBjb25maWd1cmF0aW9uLmdldFJvdXRlcygpXG4gICAgY29uc3Qgcm91dGVNYXRjaCA9IHJvdXRlSG9va01hdGNoIHx8ICFjb25maWd1cmF0aW9uUm91dGVzPy5yb290Um91dGUgPyB1bmRlZmluZWQgOiByZXNvbHZlci5tYXRjaFBhdGhXaXRoUm91dGVzKGNvbmZpZ3VyYXRpb25Sb3V0ZXMucm9vdFJvdXRlLCBjdXN0b21QYXRoKVxuXG4gICAgaWYgKCFyb3V0ZUhvb2tNYXRjaCAmJiAhcm91dGVNYXRjaCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBjdXN0b20gZnJvbnRlbmQgbW9kZWwgcm91dGUgbWF0Y2hlZCAnJHtjdXN0b21QYXRofSdgKVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGlvblBhcmFtID0gcm91dGVIb29rTWF0Y2g/LmFjdGlvbiB8fCByZXNvbHZlci5wYXJhbXMuYWN0aW9uXG4gICAgY29uc3QgY29udHJvbGxlclBhcmFtID0gcm91dGVIb29rTWF0Y2g/LmNvbnRyb2xsZXIgfHwgcmVzb2x2ZXIucGFyYW1zLmNvbnRyb2xsZXJcbiAgICBjb25zdCBhY3Rpb25WYWx1ZSA9IHR5cGVvZiBhY3Rpb25QYXJhbSA9PT0gXCJzdHJpbmdcIiA/IGFjdGlvblBhcmFtIDogKEFycmF5LmlzQXJyYXkoYWN0aW9uUGFyYW0pID8gYWN0aW9uUGFyYW1bMF0gOiB1bmRlZmluZWQpXG4gICAgY29uc3QgY29udHJvbGxlclZhbHVlID0gdHlwZW9mIGNvbnRyb2xsZXJQYXJhbSA9PT0gXCJzdHJpbmdcIiA/IGNvbnRyb2xsZXJQYXJhbSA6IChBcnJheS5pc0FycmF5KGNvbnRyb2xsZXJQYXJhbSkgPyBjb250cm9sbGVyUGFyYW1bMF0gOiB1bmRlZmluZWQpXG5cbiAgICBpZiAodHlwZW9mIGFjdGlvblZhbHVlICE9PSBcInN0cmluZ1wiIHx8IGFjdGlvblZhbHVlLmxlbmd0aCA8IDEgfHwgdHlwZW9mIGNvbnRyb2xsZXJWYWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCBjb250cm9sbGVyVmFsdWUubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDdXN0b20gZnJvbnRlbmQgbW9kZWwgcm91dGUgbWF0Y2hlZCAnJHtjdXN0b21QYXRofScgd2l0aG91dCBjb250cm9sbGVyL2FjdGlvbiBwYXJhbXNgKVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGlvbiA9IGluZmxlY3Rpb24uY2FtZWxpemUoYWN0aW9uVmFsdWUucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpLnJlcGxhY2VBbGwoXCIvXCIsIFwiX1wiKSwgdHJ1ZSlcbiAgICBjb25zdCBjb250cm9sbGVyID0gY29udHJvbGxlclZhbHVlXG4gICAgY29uc3QgY29udHJvbGxlclBhdGggPSByb3V0ZUhvb2tNYXRjaD8uY29udHJvbGxlclBhdGggfHwgYCR7Y29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKX0vc3JjL3JvdXRlcy8ke2NvbnRyb2xsZXJ9L2NvbnRyb2xsZXIuanNgXG4gICAgY29uc3Qgdmlld1BhdGggPSByb3V0ZUhvb2tNYXRjaD8udmlld1BhdGggfHwgYCR7Y29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKX0vc3JjL3JvdXRlcy8ke2NvbnRyb2xsZXJ9YFxuICAgIHJlc29sdmVyLnJvdXRlSG9va0NvbnRyb2xsZXJDbGFzcyA9IHJvdXRlSG9va01hdGNoPy5jb250cm9sbGVyQ2xhc3NcbiAgICBjb25zdCBjb250cm9sbGVyQ2xhc3MgPSBhd2FpdCByZXNvbHZlci5yZXNvbHZlQ29udHJvbGxlckNsYXNzKHtjb250cm9sbGVyUGF0aH0pXG4gICAgY29uc3QgY29udHJvbGxlclBhcmFtcyA9IG1lcmdlRnJvbnRlbmRNb2RlbFJlbW90ZVJlcXVlc3RDb250ZXh0KFxuICAgICAgcmVxdWVzdENvbnRleHQsXG4gICAgICB7XG4gICAgICAgIC4uLigocGF5bG9hZCAmJiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIikgPyBwYXlsb2FkIDoge30pLFxuICAgICAgICAuLi5yZXNvbHZlci5wYXJhbXNcbiAgICAgIH1cbiAgICApXG4gICAgY29uc3QgY29udHJvbGxlckluc3RhbmNlID0gbmV3IGNvbnRyb2xsZXJDbGFzcyh7XG4gICAgICBhY3Rpb24sXG4gICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgY29udHJvbGxlcixcbiAgICAgIHBhcmFtczogY29udHJvbGxlclBhcmFtcyxcbiAgICAgIHJlcXVlc3Q6IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5nZXRSZXF1ZXN0KCkpLFxuICAgICAgcmVzcG9uc2UsXG4gICAgICB2aWV3UGF0aFxuICAgIH0pXG5cbiAgICAvLyBQcmVzZXJ2ZSB0aGUgY2xpZW50J3Mgb3duIGNvbW1hbmQgYXJndW1lbnRzIGJlZm9yZSByb3V0ZSBmcmFtZXdvcmsgcGFyYW1zIHdvblxuICAgIC8vIHRoZSBgY29udHJvbGxlclBhcmFtc2AgbWVyZ2UgYWJvdmUsIHNvIGEgdHlwZWQgY29tbWFuZCBtZXRob2QgKGBhc3luYyBuYW1lKGFyZ3MpYClcbiAgICAvLyByZWNlaXZlcyB0aGUgY2xpZW50IHBheWxvYWQg4oCUIG5vdCB0aGUgcm91dGUncyBtZW1iZXIgaWQgLyBtb2RlbCAvIGNvbnRyb2xsZXIga2V5cy5cbiAgICBjb25zdCBjdXN0b21Db21tYW5kQ29udHJvbGxlciA9IC8qKiBAdHlwZSB7RnJvbnRlbmRNb2RlbENvbnRyb2xsZXJ9ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChjb250cm9sbGVySW5zdGFuY2UpKVxuXG4gICAgY3VzdG9tQ29tbWFuZENvbnRyb2xsZXIuX2Zyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kQ2xpZW50QXJndW1lbnRzID1cbiAgICAgIChwYXlsb2FkICYmIHR5cGVvZiBwYXlsb2FkID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHBheWxvYWQpKSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocGF5bG9hZCkgOiB7fVxuXG4gICAgYXdhaXQgdGhpcy53aXRoRnJvbnRlbmRNb2RlbFJlcXVlc3RDb250ZXh0KGNvbnRyb2xsZXJQYXJhbXMsIHJlc3BvbnNlLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjb250cm9sbGVySW5zdGFuY2UuX3J1bkJlZm9yZUNhbGxiYWNrcygpXG4gICAgICBjb25zdCBjb250cm9sbGVyTWV0aG9kcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgKCkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWQ+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGNvbnRyb2xsZXJJbnN0YW5jZSkpXG5cbiAgICAgIGF3YWl0IGNvbnRyb2xsZXJNZXRob2RzW2FjdGlvbl0oKVxuICAgIH0pXG5cbiAgICBjb25zdCBzZXRDb29raWVIZWFkZXJzID0gcmVzcG9uc2UuaGVhZGVyc1tcIlNldC1Db29raWVcIl0gfHwgW11cblxuICAgIGZvciAoY29uc3Qgc2V0Q29va2llSGVhZGVyIG9mIHNldENvb2tpZUhlYWRlcnMpIHtcbiAgICAgIHRoaXMucmVzcG9uc2UoKS5hZGRIZWFkZXIoXCJTZXQtQ29va2llXCIsIHNldENvb2tpZUhlYWRlcilcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZUJvZHkgPSByZXNwb25zZS5nZXRCb2R5KClcblxuICAgIGlmICh0eXBlb2YgcmVzcG9uc2VCb2R5ICE9PSBcInN0cmluZ1wiIHx8IHJlc3BvbnNlQm9keS5sZW5ndGggPCAxKSB7XG4gICAgICByZXR1cm4ge31cbiAgICB9XG5cbiAgICAvLyBQcmVzZXJ2ZSBuZXN0ZWQgdHJhbnNwb3J0IG1hcmtlcnMgc28gdGhlIG91dGVyIHNoYXJlZCBmcm9udGVuZC1tb2RlbCBBUElcbiAgICAvLyBjYW4gcmV0dXJuIHRoZW0gdW5jaGFuZ2VkIGFuZCBsZXQgdGhlIGNsaWVudCBoeWRyYXRlIG9uY2UgYXQgdGhlIGVkZ2UuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoSlNPTi5wYXJzZShyZXNwb25zZUJvZHkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgaW5kZXguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIENvbGxlY3Rpb24gYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEluZGV4KCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImluZGV4XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBmaW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgZmluZCBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kRmluZCgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJmaW5kXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCB1cGRhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciB1cGRhdGUgYWN0aW9uIGZvciBmcm9udGVuZCBtb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZFVwZGF0ZSgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJ1cGRhdGVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIGF0dGFjaC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIGF0dGFjaCBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kQXR0YWNoKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcImF0dGFjaFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgZG93bmxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIE1lbWJlciBkb3dubG9hZCBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kRG93bmxvYWQoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiZG93bmxvYWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZyb250ZW5kIHVybC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gTWVtYmVyIFVSTCBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kVXJsKCkge1xuICAgIGlmICh0aGlzLnJlcXVlc3QoKS5odHRwTWV0aG9kKCkgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7c3RhdHVzOiAyMDQsIGpzb246IHt9fSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbFJlbmRlckNvbW1hbmRSZXNwb25zZShcInVybFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnJvbnRlbmQgY3JlYXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgY3JlYXRlIGFjdGlvbiBmb3IgZnJvbnRlbmQgbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgYXN5bmMgZnJvbnRlbmRDcmVhdGUoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5mcm9udGVuZE1vZGVsUmVuZGVyQ29tbWFuZFJlc3BvbnNlKFwiY3JlYXRlXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBkZXN0cm95LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBNZW1iZXIgZGVzdHJveSBhY3Rpb24gZm9yIGZyb250ZW5kIG1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIGFzeW5jIGZyb250ZW5kRGVzdHJveSgpIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0KCkuaHR0cE1ldGhvZCgpID09PSBcIk9QVElPTlNcIikge1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe3N0YXR1czogMjA0LCBqc29uOiB7fX0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmZyb250ZW5kTW9kZWxSZW5kZXJDb21tYW5kUmVzcG9uc2UoXCJkZXN0cm95XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBjdXN0b20gY29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gQ3VzdG9tIGNvbGxlY3Rpb24vbWVtYmVyIGNvbW1hbmQgYWN0aW9uIGZvciBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZEN1c3RvbUNvbW1hbmQoKSB7XG4gICAgaWYgKHRoaXMucmVxdWVzdCgpLmh0dHBNZXRob2QoKSA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyKHtzdGF0dXM6IDIwNCwganNvbjoge319KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlUGF5bG9hZCA9IGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRQYXlsb2FkKClcblxuICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe1xuICAgICAgICBqc29uOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZShyZXNwb25zZVBheWxvYWQsIHRoaXMudHJhbnNwb3J0U2VyaWFsaXphdGlvbk9wdGlvbnMoKSkpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvckNvbnRleHQgPSB0aGlzLmZyb250ZW5kTW9kZWxFbmRwb2ludEVycm9yQ29udGV4dCh7YWN0aW9uOiBcImZyb250ZW5kQ3VzdG9tQ29tbWFuZFwiLCBjb21tYW5kVHlwZTogXCJjdXN0b20tY29tbWFuZFwiLCBlcnJvcn0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbExvZ0VuZHBvaW50RXJyb3Ioe2Vycm9yLCBlcnJvckNvbnRleHR9KVxuXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcih7XG4gICAgICAgIGpzb246IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc2VyaWFsaXplRnJvbnRlbmRNb2RlbFRyYW5zcG9ydFZhbHVlKGF3YWl0IHRoaXMuZnJvbnRlbmRNb2RlbENsaWVudEVycm9yUGF5bG9hZEZvckVycm9yKGVycm9yLCBlcnJvckNvbnRleHQpLCB0aGlzLnRyYW5zcG9ydFNlcmlhbGl6YXRpb25PcHRpb25zKCkpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmcm9udGVuZCBtb2RlbCBjdXN0b20gY29tbWFuZCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFJlc3BvbnNlIHBheWxvYWQuXG4gICAqL1xuICBhc3luYyBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZFBheWxvYWQoKSB7XG4gICAgY29uc3QgcGFyYW1zID0gdGhpcy5mcm9udGVuZE1vZGVsUGFyYW1zKClcbiAgICBjb25zdCBtZXRob2ROYW1lID0gcGFyYW1zLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kTWV0aG9kTmFtZVxuICAgIGNvbnN0IHNjb3BlID0gcGFyYW1zLmZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kU2NvcGVcblxuICAgIGlmICh0eXBlb2YgbWV0aG9kTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCBtZXRob2ROYW1lLmxlbmd0aCA8IDEpIHtcbiAgICAgIHJldHVybiB0aGlzLmZyb250ZW5kTW9kZWxFcnJvclBheWxvYWQoXCJFeHBlY3RlZCBmcm9udGVuZC1tb2RlbCBjdXN0b20gY29tbWFuZCBtZXRob2QgbmFtZS5cIilcbiAgICB9XG5cbiAgICBpZiAoc2NvcGUgIT09IFwiY29sbGVjdGlvblwiICYmIHNjb3BlICE9PSBcIm1lbWJlclwiKSB7XG4gICAgICByZXR1cm4gdGhpcy5mcm9udGVuZE1vZGVsRXJyb3JQYXlsb2FkKFwiRXhwZWN0ZWQgZnJvbnRlbmQtbW9kZWwgY3VzdG9tIGNvbW1hbmQgc2NvcGUuXCIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmZyb250ZW5kTW9kZWxSZXNvdXJjZUluc3RhbmNlKClcbiAgICBjb25zdCBjb21tYW5kID0gcmVzb3VyY2UucmVzb3VyY2VNZXRob2QobWV0aG9kTmFtZSlcblxuICAgIGlmICghY29tbWFuZCkge1xuICAgICAgcmV0dXJuIHRoaXMuZnJvbnRlbmRNb2RlbEVycm9yUGF5bG9hZChgTWlzc2luZyBmcm9udGVuZC1tb2RlbCBjdXN0b20gY29tbWFuZCAnJHttZXRob2ROYW1lfScuYClcbiAgICB9XG5cbiAgICAvLyBQYXNzIHRoZSBjbGllbnQgY29tbWFuZCBhcmd1bWVudHMgYXMgdGhlIG1ldGhvZCdzIGZpcnN0IGFyZ3VtZW50IHNvIGEgY29tbWFuZFxuICAgIC8vIG1ldGhvZCBjYW4gdGFrZSBhIHR5cGVkIGFyZ3Mgb2JqZWN0IChgYXN5bmMgbmFtZShhcmdzKWApIGFuZCB0aGUgZ2VuZXJhdGVkXG4gICAgLy8gZnJvbnRlbmQgbWV0aG9kIGNhbiBmb3J3YXJkIHRoZSBiYWNrZW5kIG1ldGhvZCdzIGBAcGFyYW1gLiBgdGhpcy5wYXJhbXMoKWAgaXNcbiAgICAvLyB1bmNoYW5nZWQsIHNvIGV4aXN0aW5nIHBhcmFtZXRlcmxlc3MgbWV0aG9kcyBrZWVwIHdvcmtpbmcuIFRoZSBhcmdzIGFyZSB1bnRydXN0ZWRcbiAgICAvLyBjbGllbnQgaW5wdXQgdHlwZWQgb25seSBieSB0aGUgZGVjbGFyZWQgY29udHJhY3QsIHNvIG1ldGhvZHMgbXVzdCBzdGlsbCB2YWxpZGF0ZS5cbiAgICBjb25zdCBjb21tYW5kQXJndW1lbnRzID0gdGhpcy5mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZEFyZ3VtZW50cyhwYXJhbXMpXG4gICAgY29uc3QgcmVzcG9uc2VQYXlsb2FkID0gYXdhaXQgY29tbWFuZC5tZXRob2QuY2FsbChjb21tYW5kLnJlc291cmNlLCBjb21tYW5kQXJndW1lbnRzKVxuXG4gICAgaWYgKCFyZXNwb25zZVBheWxvYWQgfHwgdHlwZW9mIHJlc3BvbnNlUGF5bG9hZCAhPT0gXCJvYmplY3RcIikge1xuICAgICAgcmV0dXJuIHtzdGF0dXM6IFwic3VjY2Vzc1wifVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKFxuICAgICAgYXdhaXQgdGhpcy5hdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQoXG4gICAgICAgIHJlc3BvbnNlUGF5bG9hZCxcbiAgICAgICAgLyoqIEB0eXBlIHt7c2VyaWFsaXplOiAobW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY3Rpb246IHN0cmluZykgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fX0gKi8gKGNvbW1hbmQucmVzb3VyY2UpLFxuICAgICAgICBtZXRob2ROYW1lXG4gICAgICApXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSB0eXBlZCBhcmd1bWVudCBvYmplY3QgcGFzc2VkIHRvIGEgY3VzdG9tIGNvbW1hbmQgbWV0aG9kLiBPbiB0aGVcbiAgICogc2hhcmVkLWVuZHBvaW50IHBhdGggdGhlIG9yaWdpbmFsIGNsaWVudCBwYXlsb2FkIHdhcyBjYXB0dXJlZCBiZWZvcmUgcm91dGVcbiAgICogZnJhbWV3b3JrIHBhcmFtcyB3ZXJlIG1lcmdlZCwgc28gaXQgaXMgcmV0dXJuZWQgdmVyYmF0aW0gKGEgY2xpZW50IGBpZGAgc3Vydml2ZXNcbiAgICogYSBtZW1iZXIgcm91dGUpLiBPbiB0aGUgZGlyZWN0IHBhdGggaXQgZmFsbHMgYmFjayB0byB0aGUgcmVxdWVzdCBwYXJhbXMgd2l0aCB0aGVcbiAgICogZnJhbWV3b3JrIGtleXMgdGhlIGNvbW1hbmQgcm91dGUgaG9vayBpbmplY3RlZCBzdHJpcHBlZCBvdXQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBEZXNlcmlhbGl6ZWQgZnJvbnRlbmQtbW9kZWwgcGFyYW1zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsaWVudCBjb21tYW5kIGFyZ3VtZW50cy5cbiAgICovXG4gIGZyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kQXJndW1lbnRzKHBhcmFtcykge1xuICAgIGlmICh0aGlzLl9mcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZENsaWVudEFyZ3VtZW50cykge1xuICAgICAgcmV0dXJuIHRoaXMuX2Zyb250ZW5kTW9kZWxDdXN0b21Db21tYW5kQ2xpZW50QXJndW1lbnRzXG4gICAgfVxuXG4gICAgY29uc3Qge1xuICAgICAgYWN0aW9uOiBfYWN0aW9uLFxuICAgICAgY29udHJvbGxlcjogX2NvbnRyb2xsZXIsXG4gICAgICBmcm9udGVuZE1vZGVsQ3VzdG9tQ29tbWFuZE1ldGhvZE5hbWU6IF9tZXRob2ROYW1lLFxuICAgICAgZnJvbnRlbmRNb2RlbEN1c3RvbUNvbW1hbmRTY29wZTogX3Njb3BlLFxuICAgICAgbW9kZWw6IF9tb2RlbCxcbiAgICAgIC4uLmNvbW1hbmRBcmd1bWVudHNcbiAgICB9ID0gcGFyYW1zXG5cbiAgICByZXR1cm4gY29tbWFuZEFyZ3VtZW50c1xuICB9XG5cbiAgLyoqXG4gICAqIFdhbGtzIGEgY3VzdG9tLWNvbW1hbmQgcmVzcG9uc2UgcGF5bG9hZCBhbmQgcmVwbGFjZXMgYW55IGJhY2tlbmQgYFJlY29yZGBcbiAgICogaW5zdGFuY2Ugd2l0aCB0aGUgcmVzb3VyY2UncyBwZXItYWN0aW9uIHNlcmlhbGl6ZWQgZm9ybSBzbyBoYW5kbGVycyBjYW5cbiAgICogcmV0dXJuIGB7cmVjb3JkLCBzdGF0dXM6IFwib2tcIn1gIGluc3RlYWQgb2YgZXhwbGljaXRseSBjYWxsaW5nXG4gICAqIGBhd2FpdCB0aGlzLnNlcmlhbGl6ZShyZWNvcmQsIGFjdGlvbilgLiBQbGFpbiBvYmplY3RzLCBhcnJheXMsIGFuZFxuICAgKiBwcmltaXRpdmUgdmFsdWVzIHBhc3MgdGhyb3VnaCBhbmQgYXJlIGxhdGVyIGVuY29kZWQgYnlcbiAgICogYHNlcmlhbGl6ZUZyb250ZW5kTW9kZWxUcmFuc3BvcnRWYWx1ZWAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUGF5bG9hZCB2YWx1ZS5cbiAgICogQHBhcmFtIHt7c2VyaWFsaXplOiAobW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhY3Rpb246IHN0cmluZykgPT4gUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fX0gcmVzb3VyY2UgLSBSZXNvdXJjZSBpbnN0YW5jZSBwcm92aWRpbmcgYHNlcmlhbGl6ZWAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBDdXN0b20gY29tbWFuZCBtZXRob2QgbmFtZSBwYXNzZWQgdG8gYHJlc291cmNlLnNlcmlhbGl6ZWAgZm9yIHBlci1hY3Rpb24gYXV0aG9yaXphdGlvbiBmaWx0ZXJpbmcuXG4gICAqIEBwYXJhbSB7V2Vha1NldDxvYmplY3Q+fSBbc2Vlbl0gLSBSZWN1cnNpb24gc3RhY2sgb2YgcGxhaW4tb2JqZWN0IGNvbnRhaW5lcnMgY3VycmVudGx5IGJlaW5nIHdhbGtlZC4gTWVtYmVyc2hpcCBpcyBhZGRlZCBvbiBlbnRyeSBhbmQgcmVtb3ZlZCBvbiBleGl0IHNvIGEgY29udGFpbmVyIHNoYXJlZCBiZXR3ZWVuIHNpYmxpbmdzIChpLmUuIHJlZmVyZW5jZWQgdHdpY2UgYnV0IG5vdCBjeWNsaWNhbGx5KSBpcyB3YWxrZWQgb24gZWFjaCByZWZlcmVuY2UgaW5zdGVhZCBvZiBiZWluZyBzaG9ydC1jaXJjdWl0ZWQgdGhlIHNlY29uZCB0aW1lLCB3aGljaCB3b3VsZCBsZXQgYmFja2VuZCBgUmVjb3JkYCBpbnN0YW5jZXMgaW5zaWRlIGl0IGJ5cGFzcyBgcmVzb3VyY2Uuc2VyaWFsaXplYC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFBheWxvYWQgd2l0aCBiYWNrZW5kIGBSZWNvcmRgIGluc3RhbmNlcyByZXBsYWNlZCBieSBzZXJpYWxpemVkIG1hcmtlcnMuXG4gICAqL1xuICBhc3luYyBhdXRvU2VyaWFsaXplRnJvbnRlbmRNb2RlbHNJblBheWxvYWQodmFsdWUsIHJlc291cmNlLCBhY3Rpb24sIHNlZW4gPSBuZXcgV2Vha1NldCgpKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH1cblxuICAgIGlmIChpc0JhY2tlbmRNb2RlbEluc3RhbmNlKHZhbHVlKSkge1xuICAgICAgY29uc3QgcmljaFNlcmlhbGl6ZWQgPSBhd2FpdCByZXNvdXJjZS5zZXJpYWxpemUodmFsdWUsIGFjdGlvbilcbiAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IHZhbHVlLmdldE1vZGVsQ2xhc3MoKS5nZXRNb2RlbE5hbWUoKVxuXG4gICAgICAvLyBXcmFwIHRoZSByZXNvdXJjZS1zZXJpYWxpemVkIHBheWxvYWQgaW4gdGhlIGZyb250ZW5kX21vZGVsIHRyYW5zcG9ydFxuICAgICAgLy8gbWFya2VyLiBNYXJrZXItYmFzZWQgZGVjb2Rpbmcgcm91dGVzIHRocm91Z2ggYGluc3RhbnRpYXRlRnJvbVJlc3BvbnNlYCxcbiAgICAgIC8vIHNvIGFiaWxpdGllcyAvIHF1ZXJ5RGF0YSAvIGFzc29jaWF0aW9uQ291bnRzIC8gcHJlbG9hZGVkUmVsYXRpb25zaGlwc1xuICAgICAgLy8gYmFrZWQgaW50byB0aGUgcmljaCBhdHRyaWJ1dGVzIGJ5IGByZXNvdXJjZS5zZXJpYWxpemVgIGFyZSByZXN0b3JlZCBvblxuICAgICAgLy8gdGhlIGNsaWVudCB3aXRob3V0IGNhbGxlcnMgbmVlZGluZyB0byB3cmFwIG1vZGVscyBtYW51YWxseS5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIF9fdmVsb2Npb3VzX3R5cGU6IFwiZnJvbnRlbmRfbW9kZWxcIixcbiAgICAgICAgYXR0cmlidXRlczogcmljaFNlcmlhbGl6ZWQsXG4gICAgICAgIG1vZGVsTmFtZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBSZXN1bHQuXG4gICAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgcmVzdWx0ID0gW11cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiB2YWx1ZSkge1xuICAgICAgICByZXN1bHQucHVzaChhd2FpdCB0aGlzLmF1dG9TZXJpYWxpemVGcm9udGVuZE1vZGVsc0luUGF5bG9hZChlbnRyeSwgcmVzb3VyY2UsIGFjdGlvbiwgc2VlbikpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHRcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSkgPT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGNvbnN0IGNvbnRhaW5lciA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodmFsdWUpXG5cbiAgICAgIGlmIChzZWVuLmhhcyhjb250YWluZXIpKSB7XG4gICAgICAgIC8vIEN5Y2xpYyBiYWNrLXJlZmVyZW5jZSBhbG9uZyB0aGUgY3VycmVudCByZWN1cnNpb24gcGF0aDsgdGhlXG4gICAgICAgIC8vIGFuY2VzdG9yIGZyYW1lIGlzIHN0aWxsIHdhbGtpbmcgdGhpcyBjb250YWluZXIgYW5kIHdpbGwgcHJvZHVjZVxuICAgICAgICAvLyBpdHMgc2VyaWFsaXplZCBmb3JtLiBSZXR1cm5pbmcgdGhlIG9yaWdpbmFsIGNvbnRhaW5lciBoZXJlXG4gICAgICAgIC8vIGJyZWFrcyB0aGUgY3ljbGUgd2l0aG91dCBieXBhc3NpbmcgdGhlIHdhbGtlciBmb3Igc2libGluZ3MgdGhhdFxuICAgICAgICAvLyBzaGFyZSBhIG5vbi1jeWNsaWMgcmVmZXJlbmNlICh0aG9zZSByZS1lbnRlciB0aGUgYnJhbmNoIGJlbG93XG4gICAgICAgIC8vIGJlY2F1c2UgdGhlIGNvbnRhaW5lciBpcyByZW1vdmVkIGZyb20gYHNlZW5gIG9uIHN0YWNrIGV4aXQpLlxuICAgICAgICByZXR1cm4gY29udGFpbmVyXG4gICAgICB9XG5cbiAgICAgIHNlZW4uYWRkKGNvbnRhaW5lcilcblxuICAgICAgdHJ5IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlc3VsdC5cbiAgICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIG5lc3RlZF0gb2YgT2JqZWN0LmVudHJpZXMoY29udGFpbmVyKSkge1xuICAgICAgICAgIC8vIGBhc3NpZ25TYWZlUHJvcGVydHlgIHN0b3JlcyBrZXlzIGxpa2UgYF9fcHJvdG9fX2AgYXMgb3duXG4gICAgICAgICAgLy8gZGF0YSBwcm9wZXJ0aWVzIGluc3RlYWQgb2YgaW52b2tpbmcgdGhlIHByb3RvdHlwZSBzZXR0ZXIsXG4gICAgICAgICAgLy8gc28gYSBjdXN0b20tY29tbWFuZCByZXNwb25zZSB0aGF0IGVjaG9lcyBwYXJzZWQgY2xpZW50XG4gICAgICAgICAgLy8gaW5wdXQgY2Fubm90IHBvbGx1dGUgYE9iamVjdC5wcm90b3R5cGVgIGhlcmUuIFRoZSB0cmFuc3BvcnRcbiAgICAgICAgICAvLyBzZXJpYWxpemVyIGFwcGxpZXMgdGhlIHNhbWUgcHJvdGVjdGlvbiBvbiBpdHMgb3duIHBhc3M7IHdlXG4gICAgICAgICAgLy8ganVzdCBwcmVzZXJ2ZSBpdCBhY3Jvc3MgdGhlIGF1dG8tc2VyaWFsaXplIHdhbGsuXG4gICAgICAgICAgYXNzaWduU2FmZVByb3BlcnR5KHJlc3VsdCwga2V5LCBhd2FpdCB0aGlzLmF1dG9TZXJpYWxpemVGcm9udGVuZE1vZGVsc0luUGF5bG9hZChuZXN0ZWQsIHJlc291cmNlLCBhY3Rpb24sIHNlZW4pKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgc2Vlbi5kZWxldGUoY29udGFpbmVyKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbn1cbiJdfQ==