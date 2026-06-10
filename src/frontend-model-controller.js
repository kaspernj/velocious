// @ts-check

import * as inflection from "inflection"
import Controller from "./controller.js"
import Response from "./http-server/client/response.js"
import FrontendModelBaseResource from "./frontend-model-resource/base-resource.js"
import {frontendModelResourceClassFromDefinition, frontendModelResourceConfigurationFromDefinition, frontendModelResourcePath, frontendModelResourcesForBackendProject} from "./frontend-models/resource-definition.js"
import {normalizeGroup as normalizeQueryGroup, normalizeJoins as normalizeQueryJoins, normalizePluck as normalizeQueryPluck, normalizePreload as normalizeQueryPreload, normalizeSearchOperator as normalizeQuerySearchOperator, normalizeSort as normalizeQuerySort} from "./frontend-models/query.js"
import {assignSafeProperty, deserializeFrontendModelTransportValue, isBackendModelInstance, serializeFrontendModelTransportValue} from "./frontend-models/transport-serialization.js"
import RoutesResolver from "./routes/resolver.js"
import {ValidationError} from "./database/record/index.js"
import VelociousError from "./velocious-error.js"
import isPlainObject from "./utils/plain-object.js"

/**
 * @param {import("./database/query/index.js").NestedPreloadRecord | string | string[] | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Normalized preload.
 */
function normalizeFrontendModelPreload(preload) {
  if (!preload) return null

  return normalizeQueryPreload(preload)
}

/**
 * @param {?} joins - Joins payload.
 * @returns {Record<string, ?> | null} - Normalized relationship-object joins.
 */
function normalizeFrontendModelJoins(joins) {
  if (!joins) return null

  try {
    return normalizeQueryJoins(joins)
  } catch (error) {
    throw frontendModelValidationErrorForError(error)
  }
}

/**
 * @param {?} select - Select payload.
 * @param {string | null} [rootModelName] - Optional root model name for shorthand payloads.
 * @returns {Record<string, string[]> | null} - Normalized model-name keyed select record.
 */
function normalizeFrontendModelSelect(select, rootModelName = null) {
  if (!select) return null

  if (typeof select === "string") {
    if (!rootModelName) {
      throw frontendModelValidationError("Invalid select shorthand without root model name")
    }

    return {[rootModelName]: [select]}
  }

  if (Array.isArray(select)) {
    if (!rootModelName) {
      throw frontendModelValidationError("Invalid select shorthand without root model name")
    }

    for (const attributeName of select) {
      if (typeof attributeName !== "string") {
        throw frontendModelValidationError(`Invalid select attribute for ${rootModelName}: ${typeof attributeName}`)
      }
    }

    return {[rootModelName]: Array.from(new Set(select))}
  }

  if (!isPlainObject(select)) {
    throw frontendModelValidationError(`Invalid select type: ${typeof select}`)
  }

  /** @type {Record<string, string[]>} */
  const normalized = {}

  for (const [modelName, selectValue] of Object.entries(select)) {
    if (typeof selectValue === "string") {
      normalized[modelName] = [selectValue]
      continue
    }

    if (!Array.isArray(selectValue)) {
      throw frontendModelValidationError(`Invalid select value for ${modelName}: ${typeof selectValue}`)
    }

    for (const attributeName of selectValue) {
      if (typeof attributeName !== "string") {
        throw frontendModelValidationError(`Invalid select attribute for ${modelName}: ${typeof attributeName}`)
      }
    }

    normalized[modelName] = Array.from(new Set(selectValue))
  }

  return normalized
}

/**
 * @typedef {object} FrontendModelSearch
 * @property {string[]} path - Relationship path.
 * @property {string} column - Column or attribute name.
 * @property {"eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {?} value - Search value.
 */

/**
 * @typedef {object} FrontendModelSort
 * @property {string} column - Attribute name to sort by.
 * @property {"asc" | "desc"} direction - Sort direction.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @typedef {object} FrontendModelGroup
 * @property {string} column - Attribute name to group by.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @typedef {object} FrontendModelPluck
 * @property {string} column - Attribute name to pluck.
 * @property {string[]} path - Relationship path from root model.
 */

/**
 * @typedef {object} FrontendModelPagination
 * @property {number | null} limit - Maximum number of records.
 * @property {number | null} offset - Number of records to skip.
 * @property {number | null} page - 1-based page number.
 * @property {number | null} perPage - Page size.
 */

const frontendModelJoinedPathsSymbol = Symbol("frontendModelJoinedPaths")
const frontendModelGroupedColumnsSymbol = Symbol("frontendModelGroupedColumns")
const frontendModelWhereNoMatchSymbol = Symbol("frontendModelWhereNoMatch")
const frontendModelClientSafeErrorMessage = "Request failed."
const frontendModelDebugErrorEnvironments = new Set(["development", "test"])

/**
 * @param {import("./database/query/model-class-query.js").default} query - Query instance.
 * @returns {import("./database/query/model-class-query.js").default & {[frontendModelJoinedPathsSymbol]?: Set<string>, [frontendModelGroupedColumnsSymbol]?: Set<string>}} - Query metadata access helper.
 */
function frontendModelQueryMetadata(query) {
  return /** @type {import("./database/query/model-class-query.js").default & {[frontendModelJoinedPathsSymbol]?: Set<string>, [frontendModelGroupedColumnsSymbol]?: Set<string>}} */ (query)
}

/**
 * @param {string} message - Validation error message.
 * @returns {VelociousError} - Client-safe validation error.
 */
function frontendModelValidationError(message) {
  return VelociousError.safe(message, {code: "frontend-model-validation"})
}

/**
 * @param {?} error - Error raised while normalizing client query params.
 * @returns {VelociousError} - Client-safe validation error preserving the normalizer message.
 */
function frontendModelValidationErrorForError(error) {
  if (error instanceof VelociousError && error.safeToExpose) return error

  const message = error instanceof Error
    ? error.message
    : String(error)

  return frontendModelValidationError(message)
}

/**
 * Whether the error carries an `error.velocious` metadata bag. The
 * presence of any such bag marks the error as "annotated by the
 * developer for the frontend" — the framework treats it as
 * user-facing: surface the message, forward the metadata, and skip
 * the noisy endpoint-error log.
 *
 * @param {?} error - Caught error.
 * @returns {boolean}
 */
function frontendModelErrorHasVelociousMetadata(error) {
  return Boolean(error && typeof error === "object" && /** @type {?} */ (error).velocious && typeof /** @type {?} */ (error).velocious === "object")
}

/**
 * @param {?} error - Caught error.
 * @returns {Record<string, ?> | null}
 */
function frontendModelVelociousMetadataForError(error) {
  if (!frontendModelErrorHasVelociousMetadata(error)) return null
  return /** @type {Record<string, ?>} */ (/** @type {?} */ (error).velocious)
}

/**
 * @param {?} error - Caught error.
 * @returns {string} - Message safe to return to API clients.
 */
function frontendModelClientMessageForError(error) {
  if (error instanceof VelociousError && error.safeToExpose) {
    return error.message
  }

  if (frontendModelErrorHasVelociousMetadata(error) && error instanceof Error) {
    return error.message
  }

  return frontendModelClientSafeErrorMessage
}

/**
 * @param {object} args - Arguments.
 * @param {import("./configuration.js").default} args.configuration - Current configuration.
 * @param {string} args.environment - Current environment.
 * @param {?} args.error - Caught error.
 * @returns {Record<string, ?>} - Optional debug payload for non-production environments.
 */
function frontendModelDebugPayloadForError({configuration, environment, error}) {
  const debugAllowed = frontendModelDebugErrorEnvironments.has(environment) || environment !== "production" && configuration.getExposeInternalErrorsToClients()

  if (!debugAllowed) {
    return {}
  }

  if (error instanceof VelociousError && error.safeToExpose) {
    return {}
  }

  if (frontendModelErrorHasVelociousMetadata(error)) {
    return {}
  }

  const debugErrorClass = error instanceof Error && error.name
    ? error.name
    : typeof error
  const debugErrorMessage = error instanceof Error
    ? error.message
    : String(error)
  const debugBacktrace = error instanceof Error && typeof error.stack === "string" && error.stack.length > 0
    ? error.stack.split("\n")
    : undefined

  return {
    debugErrorClass,
    debugErrorMessage,
    ...(debugBacktrace ? {debugBacktrace} : {})
  }
}

/**
 * @param {?} searches - Search payload.
 * @returns {FrontendModelSearch[]} - Normalized searches.
 */
function normalizeFrontendModelSearches(searches) {
  if (!searches) return []

  if (!Array.isArray(searches)) {
    throw frontendModelValidationError(`Invalid searches type: ${typeof searches}`)
  }

  /** @type {FrontendModelSearch[]} */
  const normalized = []

  for (const search of searches) {
    if (!isPlainObject(search)) {
      throw frontendModelValidationError(`Invalid search entry type: ${typeof search}`)
    }

    const path = search.path
    const column = search.column
    const operator = search.operator

    if (!Array.isArray(path)) {
      throw frontendModelValidationError("Invalid search path: expected an array")
    }

    for (const pathEntry of path) {
      if (typeof pathEntry !== "string" || pathEntry.length < 1) {
        throw frontendModelValidationError("Invalid search path entry: expected non-empty string")
      }
    }

    if (typeof column !== "string" || column.length < 1) {
      throw frontendModelValidationError("Invalid search column: expected non-empty string")
    }

    if (typeof operator !== "string") {
      throw frontendModelValidationError(`Invalid search operator: ${operator}`)
    }

    normalized.push({
      column,
      operator: normalizeQuerySearchOperator(operator),
      path: [...path],
      value: search.value
    })
  }

  return normalized
}

/**
 * @param {?} where - Where payload.
 * @returns {Record<string, ?> | null} - Normalized where hash.
 */
function normalizeFrontendModelWhere(where) {
  if (!where) return null

  if (!isPlainObject(where)) {
    throw frontendModelValidationError(`Invalid where type: ${typeof where}`)
  }

  return where
}

/**
 * @param {?} ransack - Ransack payload.
 * @returns {Record<string, ?> | null} - Normalized Ransack hash.
 */
function normalizeFrontendModelRansack(ransack) {
  if (!ransack) return null

  if (!isPlainObject(ransack)) {
    throw frontendModelValidationError(`Invalid ransack type: ${typeof ransack}`)
  }

  return ransack
}

/**
 * @param {?} value - Candidate integer.
 * @param {string} name - Param name for errors.
 * @param {number} min - Minimum allowed value.
 * @returns {number | null} - Normalized integer.
 */
function normalizeFrontendModelIntegerParam(value, name, min) {
  if (value == null) return null

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw frontendModelValidationError(`Invalid ${name}: expected integer number`)
  }

  if (value < min) {
    throw frontendModelValidationError(`Invalid ${name}: expected value >= ${min}`)
  }

  return value
}

/**
 * @param {object} args - Pagination args.
 * @param {?} args.limit - Limit payload.
 * @param {?} args.offset - Offset payload.
 * @param {?} args.page - Page payload.
 * @param {?} args.perPage - Per-page payload.
 * @returns {FrontendModelPagination} - Normalized pagination data.
 */
function normalizeFrontendModelPagination({limit, offset, page, perPage}) {
  return {
    limit: normalizeFrontendModelIntegerParam(limit, "limit", 0),
    offset: normalizeFrontendModelIntegerParam(offset, "offset", 0),
    page: normalizeFrontendModelIntegerParam(page, "page", 1),
    perPage: normalizeFrontendModelIntegerParam(perPage, "perPage", 1)
  }
}

/**
 * @param {?} distinct - Distinct payload.
 * @returns {boolean | null} - Normalized distinct flag when provided.
 */
function normalizeFrontendModelDistinct(distinct) {
  if (distinct == null) return null

  if (typeof distinct !== "boolean") {
    throw frontendModelValidationError(`Invalid distinct: expected boolean`)
  }

  return distinct
}

/**
 * @param {string[]} path - Relationship path.
 * @returns {Record<string, ?>} - Join object.
 */
function buildFrontendModelJoinObjectFromPath(path) {
  /** @type {Record<string, ?>} */
  const joinObject = {}
  /** @type {Record<string, ?>} */
  let currentNode = joinObject

  for (const relationshipName of path) {
    currentNode[relationshipName] = {}
    currentNode = currentNode[relationshipName]
  }

  return joinObject
}

/**
 * Build a successful single-model frontend-model response payload.
 * @param {Record<string, ?>} model - Serialized model payload.
 * @returns {{model: Record<string, ?>, status: "success"}} - Success response payload.
 */
function frontendModelSerializedModelSuccess(model) {
  return {model, status: "success"}
}

/**
 * Resolve and validate attachment params shared by attachment commands.
 * @param {Record<string, ?>} params - Frontend-model request params.
 * @returns {{attachmentId: string | undefined, attachmentName: string} | string} - Attachment params or validation error message.
 */
function frontendModelAttachmentParams(params) {
  const attachmentName = params.attachmentName

  if (typeof attachmentName !== "string" || attachmentName.length < 1) {
    return "Expected attachmentName."
  }

  return {
    attachmentId: typeof params.attachmentId === "string" ? params.attachmentId : undefined,
    attachmentName
  }
}

/**
 * Extract mutation attributes shared by create and update commands.
 * @param {Record<string, ?>} params - Frontend-model request params.
 * @returns {{attributes: Record<string, ?>, nestedAttributes: Record<string, ?> | null} | string} - Mutation attributes or validation error message.
 */
function frontendModelMutationAttributes(params) {
  const attributes = params.attributes

  if (!attributes || typeof attributes !== "object") {
    return "Expected model attributes."
  }

  return {
    attributes,
    nestedAttributes: params.nestedAttributes && typeof params.nestedAttributes === "object"
      ? /** @type {Record<string, ?>} */ (params.nestedAttributes)
      : null
  }
}

/** Controller with built-in frontend model resource actions. */
export default class FrontendModelController extends Controller {
  /** @type {Record<string, ?> | undefined} */
  _frontendModelParams = undefined
  /** @type {Record<string, ?> | undefined} */
  _frontendModelParamsOverride = undefined
  /** @type {import("./authorization/ability.js").default | undefined} */
  _frontendModelAbilityOverride = undefined

  /**
   * @returns {Record<string, ?>} - Decoded request params.
   */
  frontendModelParams() {
    if (this._frontendModelParamsOverride) {
      return this._frontendModelParamsOverride
    }

    this._frontendModelParams ||= /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(this.params()))

    return this._frontendModelParams
  }

  /**
   * @template T
   * @param {Record<string, ?>} params - Temporary frontend model params.
   * @param {() => Promise<T>} callback - Callback executed with temporary params.
   * @returns {Promise<T>} - Callback return value.
   */
  async withFrontendModelParams(params, callback) {
    const previousOverride = this._frontendModelParamsOverride
    const previousParams = this._frontendModelParams

    this._frontendModelParamsOverride = params
    this._frontendModelParams = undefined

    try {
      return await callback()
    } finally {
      this._frontendModelParamsOverride = previousOverride
      this._frontendModelParams = previousParams
    }
  }

  /**
   * @template T
   * @param {Record<string, ?>} params - Request-scoped params.
   * @param {import("./http-server/client/response.js").default} response - Response instance.
   * @param {() => Promise<T>} callback - Callback executed inside resolved tenant and ability context.
   * @returns {Promise<T>} - Callback return value.
   */
  async withFrontendModelRequestContext(params, response, callback) {
    const configuration = this.getConfiguration()
    const tenant = await configuration.resolveTenant({
      params,
      request: this.request(),
      response
    })

    return await configuration.runWithTenant(tenant, async () => {
      return await configuration.ensureConnections({name: "Frontend model request"}, async () => {
        const ability = await configuration.resolveAbility({
          params,
          request: this.request(),
          response
        })
        /** @type {import("./authorization/ability.js").default | undefined} */
        const previousAbilityOverride = this._frontendModelAbilityOverride

        this._frontendModelAbilityOverride = ability

        try {
          return await configuration.runWithAbility(ability, async () => {
            return await callback()
          })
        } finally {
          this._frontendModelAbilityOverride = previousAbilityOverride
        }
      })
    })
  }

  /** @returns {import("./authorization/ability.js").default | undefined} - Current ability for frontend-model request scope. */
  currentAbility() {
    return this._frontendModelAbilityOverride || super.currentAbility()
  }

  /**
   * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
   */
  frontendModelClass() {
    const frontendModelClass = this.frontendModelClassFromConfiguration()
    const params = this.frontendModelParams()
    const modelName = typeof params.model === "string" ? params.model : undefined
    const controllerName = typeof params.controller === "string" ? params.controller : undefined

    if (frontendModelClass) return frontendModelClass

    throw new Error(`No frontend model configured for model '${modelName || "unknown"}' and controller '${controllerName || "unknown"}'. Ensure a FrontendModelBaseResource subclass exists in src/resources/ or is listed in the ability resolver.`)
  }

  /**
   * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
   */
  frontendModelResourceConfiguration() {
    const params = this.frontendModelParams()
    const modelName = typeof params.model === "string" ? params.model : undefined
    const controllerName = typeof params.controller === "string" ? params.controller : undefined
    const backendProjects = this.getConfiguration().getBackendProjects()

    for (const backendProject of backendProjects) {
      const resources = frontendModelResourcesForBackendProject(backendProject)

      if (modelName && modelName.length > 0 && resources[modelName]) {
        const resourceDefinition = resources[modelName]
        const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)
        const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition)

        if (!resourceConfiguration || !resourceClass) {
          throw new Error(`Frontend model resource '${modelName}' must be a FrontendModelBaseResource subclass`)
        }

        return {
          backendProject,
          modelName,
          resourceClass,
          resourceConfiguration
        }
      }

      if (!controllerName || controllerName.length < 1) continue

      for (const resourceModelName in resources) {
        const resourceDefinition = resources[resourceModelName]
        const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)
        const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition)

        if (!resourceConfiguration || !resourceClass) {
          throw new Error(`Frontend model resource '${resourceModelName}' must be a FrontendModelBaseResource subclass`)
        }

        const resourcePath = this.frontendModelResourcePath(resourceModelName, resourceDefinition)

        if (this.frontendModelResourceMatchesController({controllerName, resourcePath})) {
          return {
            backendProject,
            modelName: resourceModelName,
            resourceClass,
            resourceConfiguration
          }
        }
      }
    }

    return null
  }

  /**
   * @param {object} args - Arguments.
   * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
   * @param {string} args.modelName - Model name.
   * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model name.
   */
  frontendModelResourceConfigurationForBackendProjectModelName({backendProject, modelName}) {
    const resources = frontendModelResourcesForBackendProject(backendProject)
    const resourceDefinition = resources[modelName]

    if (!resourceDefinition) return null

    const resourceConfiguration = frontendModelResourceConfigurationFromDefinition(resourceDefinition)
    const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition)

    if (!resourceConfiguration || !resourceClass) return null

    return {
      backendProject,
      modelName,
      resourceClass,
      resourceConfiguration
    }
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model class.
   */
  frontendModelResourceConfigurationForModelClass(modelClass) {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    return this.frontendModelResourceConfigurationForBackendProjectModelName({
      backendProject: frontendModelResource.backendProject,
      modelName: modelClass.getModelName()
    })
  }

  /**
   * @param {{modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType}} frontendModelResource - Frontend model resource configuration.
   * @returns {typeof import("./database/record/index.js").default | null} - Backing record class, when available.
   */
  frontendModelResourceModelClass(frontendModelResource) {
    const resourceModelClass = frontendModelResource.resourceClass.ModelClass

    if (resourceModelClass) return resourceModelClass

    return this.getConfiguration().getModelClasses()[frontendModelResource.modelName] || null
  }

  /**
   * @returns {typeof import("./database/record/index.js").default | null} - Frontend model class resolved from backend project configuration.
   */
  frontendModelClassFromConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    const resourceModelClass = this.frontendModelResourceModelClass(frontendModelResource)

    if (resourceModelClass) return resourceModelClass

    const modelClasses = this.getConfiguration().getModelClasses()
    const modelClass = modelClasses[frontendModelResource.modelName]

    if (!modelClass) {
      throw new Error(`Frontend model '${frontendModelResource.modelName}' is configured for '${this.frontendModelParams().controller}', but no model class was registered. Registered models: ${Object.keys(modelClasses).join(", ")}`)
    }

    return modelClass
  }

  /**
   * Ensures the frontend model class and requested preload target classes are initialized.
   * This handles the case where model initialization was skipped at startup (e.g., browser tests).
   * @returns {Promise<void>} - Resolves when the model class is ready.
   */
  async ensureFrontendModelClassInitialized() {
    const frontendModelResource = this.frontendModelResourceConfiguration()
    const modelClass = this.frontendModelClassFromConfiguration()

    if (!modelClass) return

    await this.ensureFrontendModelRecordClassInitialized(modelClass)

    if (!frontendModelResource) return

    await this.ensureFrontendModelPreloadClassesInitialized({
      backendProject: frontendModelResource.backendProject,
      modelClass,
      preload: this.frontendModelPreload()
    })
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class to initialize.
   * @returns {Promise<void>} - Resolves when the model class is ready.
   */
  async ensureFrontendModelRecordClassInitialized(modelClass) {
    if (!modelClass || modelClass.isInitialized()) return

    const configuration = this.getConfiguration()

    if (typeof modelClass.ensureInitialized === "function") {
      await modelClass.ensureInitialized({configuration})
    } else if (typeof modelClass.initializeRecord === "function") {
      await modelClass.initializeRecord({configuration})
    }
  }

  /**
   * @param {object} args - Arguments.
   * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class whose preload tree is being resolved.
   * @param {import("./database/query/index.js").NestedPreloadRecord | null} args.preload - Normalized preload tree.
   * @returns {Promise<void>} - Resolves when preload target classes are initialized.
   */
  async ensureFrontendModelPreloadClassesInitialized({backendProject, modelClass, preload}) {
    if (!preload) return

    for (const [relationshipName, relationshipPreload] of Object.entries(preload)) {
      if (relationshipPreload === false) continue

      const relationship = modelClass.getRelationshipByName(relationshipName)
      const targetModelClass = await this.ensureFrontendModelRelationshipTargetClassInitialized({
        backendProject,
        relationship
      })

      if (!targetModelClass || !isPlainObject(relationshipPreload)) continue

      await this.ensureFrontendModelPreloadClassesInitialized({
        backendProject,
        modelClass: targetModelClass,
        preload: /** @type {import("./database/query/index.js").NestedPreloadRecord} */ (relationshipPreload)
      })
    }
  }

  /**
   * @param {object} args - Arguments.
   * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
   * @param {import("./database/record/relationships/base.js").default} args.relationship - Relationship definition.
   * @returns {Promise<typeof import("./database/record/index.js").default | null>} - Target model class, when available.
   */
  async ensureFrontendModelRelationshipTargetClassInitialized({backendProject, relationship}) {
    if (relationship.through) {
      const throughRelationship = relationship.getModelClass().getRelationshipByName(relationship.through)
      await this.ensureFrontendModelRelationshipTargetClassInitialized({
        backendProject,
        relationship: throughRelationship
      })
    }

    const targetModelClass = this.frontendModelRelationshipTargetModelClass({
      backendProject,
      relationship
    })

    if (!targetModelClass) return null

    await this.ensureFrontendModelRecordClassInitialized(targetModelClass)

    return targetModelClass
  }

  /**
   * @param {object} args - Arguments.
   * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
   * @param {import("./database/record/relationships/base.js").default} args.relationship - Relationship definition.
   * @returns {typeof import("./database/record/index.js").default | null} - Target model class, when available.
   */
  frontendModelRelationshipTargetModelClass({backendProject, relationship}) {
    if (relationship.getPolymorphic() && relationship.getType() === "belongsTo") return null

    if (relationship.klass) return relationship.klass

    if (relationship.className) {
      const frontendModelResource = this.frontendModelResourceConfigurationForBackendProjectModelName({
        backendProject,
        modelName: relationship.className
      })
      const resourceModelClass = frontendModelResource ? this.frontendModelResourceModelClass(frontendModelResource) : null

      if (resourceModelClass) return resourceModelClass

      const registeredModelClass = this.getConfiguration().getModelClasses()[relationship.className]

      if (registeredModelClass) return registeredModelClass
    }

    const targetModelClass = relationship.getTargetModelClass()

    return targetModelClass || null
  }

  /**
   * @param {string} modelName - Model class name.
   * @param {?} resourceDefinition - Resource definition.
   * @returns {string} - Normalized resource path.
   */
  frontendModelResourcePath(modelName, resourceDefinition) {
    return frontendModelResourcePath(modelName, resourceDefinition)
  }

  /**
   * @param {object} args - Arguments.
   * @param {string} args.controllerName - Controller name from params.
   * @param {string} args.resourcePath - Resource path from configuration.
   * @returns {boolean} - Whether resource path matches current controller.
   */
  frontendModelResourceMatchesController({controllerName, resourcePath}) {
    const normalizedController = controllerName.replace(/^\/+|\/+$/g, "")
    const normalizedResourcePath = resourcePath.replace(/^\/+|\/+$/g, "")

    if (normalizedResourcePath === normalizedController) return true

    return normalizedResourcePath.endsWith(`/${normalizedController}`)
  }

  /**
   * @returns {FrontendModelBaseResource} - Backend resource instance for current frontend-model action.
   */
  frontendModelResourceInstance() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) {
      throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`)
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
    }

    return new frontendModelResource.resourceClass(resourceArgs)
  }

  /**
   * @returns {string} - Frontend model primary key.
   */
  frontendModelPrimaryKey() {
    return this.frontendModelClass().primaryKey()
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Frontend action.
   * @returns {string} - Ability action configured for the frontend action.
   */
  frontendModelAbilityAction(action) {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) {
      throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`)
    }

    const abilities = frontendModelResource.resourceConfiguration.abilities

    if (!abilities || typeof abilities !== "object") {
      throw new Error(`Resource '${frontendModelResource.modelName}' must define an 'abilities' object`)
    }

    const abilityKey = action === "attach"
      ? "update"
      : ((action === "download" || action === "url") ? "find" : action)
    const abilityAction = abilities[abilityKey]

    if (typeof abilityAction !== "string" || abilityAction.length < 1) {
      throw new Error(`Resource '${frontendModelResource.modelName}' must define abilities.${abilityKey}`)
    }

    return abilityAction
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Frontend action.
   * @returns {import("./database/query/model-class-query.js").default<?>} - Authorized query for the action.
   */
  frontendModelAuthorizedQuery(action) {
    const abilityAction = this.frontendModelAbilityAction(action)

    return this.frontendModelClass().accessibleFor(abilityAction, this.currentAbility())
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {string} - Primary key value as string.
   */
  frontendModelPrimaryKeyValue(model) {
    const columnName = this.frontendModelPrimaryKey()
    const attributeNameMap = model.getModelClass().getColumnNameToAttributeNameMap()
    const attributeName = attributeNameMap[columnName] || columnName
    const value = model.readAttribute(attributeName)

    return String(value)
  }

  /**
   * @param {object} args - Arguments.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} args.action - Frontend action.
   * @param {import("./database/record/index.js").default[]} args.models - Candidate models.
   * @returns {Promise<import("./database/record/index.js").default[]>} - Authorized models.
   */
  async frontendModelFilterAuthorizedModels({action, models}) {
    if (models.length === 0) return models

    const primaryKey = this.frontendModelPrimaryKey()
    const ids = models.map((model) => this.frontendModelPrimaryKeyValue(model))
    const authorizedQuery = this.frontendModelAuthorizedQuery(action).where({[primaryKey]: ids})

    const authorizedIdsRaw = await authorizedQuery.pluck(primaryKey)

    const authorizedIds = new Set(authorizedIdsRaw.map((id) => String(id)))

    return models.filter((model) => authorizedIds.has(this.frontendModelPrimaryKeyValue(model)))
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Frontend action.
   * @returns {Promise<boolean>} - Whether action should continue.
   */
  async runFrontendModelBeforeAction(action) {
    const result = await this.frontendModelResourceInstance().beforeAction(action)

    return result !== false
  }

  /**
   * @param {"find" | "update" | "destroy" | "attach" | "download" | "url"} action - Frontend action.
   * @param {string | number} id - Record id.
   * @returns {Promise<import("./database/record/index.js").default | null>} - Located model record.
   */
  async frontendModelFindRecord(action, id) {
    const model = await this.frontendModelResourceInstance().find(action, id)

    if (!model) return null

    const authorizedModels = await this.frontendModelFilterAuthorizedModels({action, models: [model]})

    return authorizedModels[0] || null
  }

  /**
   * @param {Record<string, ?>} attributes - Create attributes.
   * @param {Record<string, ?> | null} [nestedAttributes] - Optional nested-attribute payload for cascading writes.
   * @returns {Promise<import("./database/record/index.js").default | null>} - Created model when authorized.
   */
  async frontendModelCreateRecord(attributes, nestedAttributes = null) {
    const resource = this.frontendModelResourceInstance()
    const model = await resource.create(attributes, {nestedAttributes, controller: this})

    const authorizedModels = await this.frontendModelFilterAuthorizedModels({action: "create", models: [model]})

    if (authorizedModels.length > 0) {
      return authorizedModels[0]
    }

    await resource.handleUnauthorizedCreatedModel(model)

    return null
  }

  /**
   * @returns {Promise<import("./database/record/index.js").default[]>} - Frontend model records.
   */
  async frontendModelRecords() {
    const models = await this.frontendModelResourceInstance().records()

    return await this.frontendModelFilterAuthorizedModels({action: "index", models})
  }

  /**
   * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Frontend preload data.
   */
  frontendModelPreload() {
    return normalizeFrontendModelPreload(this.frontendModelParams().preload)
  }

  /**
   * @returns {Record<string, string[]> | null} - Frontend select data.
   */
  frontendModelSelect() {
    return normalizeFrontendModelSelect(this.frontendModelParams().select, this.frontendModelClass().getModelName())
  }

  /**
   * @returns {Record<string, string[]> | null} - Frontend extra-select data (defaults plus these), keyed by model name.
   */
  frontendModelSelectsExtra() {
    return normalizeFrontendModelSelect(this.frontendModelParams().selectsExtra, this.frontendModelClass().getModelName())
  }

  /**
   * @returns {FrontendModelSearch[]} - Frontend search filters.
   */
  frontendModelSearches() {
    return normalizeFrontendModelSearches(this.frontendModelParams().searches)
  }

  /**
   * @returns {Record<string, ?> | null} - Frontend where filters.
   */
  frontendModelWhere() {
    return normalizeFrontendModelWhere(this.frontendModelParams().where)
  }

  /** @returns {Record<string, ?> | null} - Frontend Ransack filters. */
  frontendModelRansack() {
    return normalizeFrontendModelRansack(this.frontendModelParams().ransack)
  }

  /** @returns {Record<string, ?> | null} - Frontend joins descriptors. */
  frontendModelJoins() {
    return normalizeFrontendModelJoins(this.frontendModelParams().joins)
  }

  /** @returns {FrontendModelSort[]} - Frontend sort definitions. */
  frontendModelSort() {
    return normalizeQuerySort(this.frontendModelParams().sort)
  }

  /** @returns {FrontendModelGroup[]} - Frontend group definitions. */
  frontendModelGroup() {
    try {
      return normalizeQueryGroup(this.frontendModelParams().group)
    } catch (error) {
      throw frontendModelValidationErrorForError(error)
    }
  }

  /** @returns {FrontendModelPagination} - Frontend pagination params. */
  frontendModelPagination() {
    const params = this.frontendModelParams()

    return normalizeFrontendModelPagination({
      limit: params.limit,
      offset: params.offset,
      page: params.page,
      perPage: params.perPage
    })
  }

  /** @returns {boolean | null} - Frontend distinct flag when provided. */
  frontendModelDistinct() {
    return normalizeFrontendModelDistinct(this.frontendModelParams().distinct)
  }

  /** @returns {FrontendModelPluck[]} - Frontend pluck definitions. */
  frontendModelPluck() {
    try {
      return normalizeQueryPluck(this.frontendModelParams().pluck)
    } catch (error) {
      throw frontendModelValidationErrorForError(error)
    }
  }

  /** @returns {boolean} - Whether the request asks for an aggregate count. */
  frontendModelCountRequested() {
    return this.frontendModelParams().count === true
  }

  /**
   * @returns {Array<{attributeName: string, relationshipName: string, where?: Record<string, ?>}>}
   *   Frontend withCount entries. Empty array when not requested.
   */
  frontendModelWithCount() {
    const raw = this.frontendModelParams().withCount

    if (!Array.isArray(raw)) return []

    /** @type {Array<{attributeName: string, relationshipName: string, where?: Record<string, ?>}>} */
    const entries = []

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue
      if (typeof entry.attributeName !== "string" || entry.attributeName.length === 0) continue
      if (typeof entry.relationshipName !== "string" || entry.relationshipName.length === 0) continue

      entries.push({
        attributeName: entry.attributeName,
        relationshipName: entry.relationshipName,
        where: entry.where && typeof entry.where === "object" ? entry.where : undefined
      })
    }

    return entries
  }

  /**
   * Resolve an entry from the frontend-model `abilities` payload to
   * its backend model class by looking up the resource by modelName
   * across all configured backend projects. Returns null when no
   * resource matches — the spec entry is then silently ignored so a
   * caller requesting abilities for a model they cannot resolve does
   * not crash the request.
   *
   * @param {string} modelName
   * @returns {typeof import("./database/record/index.js").default | null}
   */
  _frontendModelClassForAbilities(modelName) {
    if (typeof modelName !== "string" || modelName.length === 0) return null

    const configuration = this.getConfiguration()
    const backendProjects = configuration?.getBackendProjects?.() ?? []

    for (const backendProject of backendProjects) {
      const frontendModels = backendProject?.frontendModels
      if (!frontendModels || typeof frontendModels !== "object") continue

      const resourceDefinition = frontendModels[modelName]
      if (!resourceDefinition) continue

      const resourceClass = frontendModelResourceClassFromDefinition(resourceDefinition)
      if (!resourceClass) continue

      const modelClass = typeof resourceClass.modelClass === "function"
        ? resourceClass.modelClass()
        : resourceClass.ModelClass

      if (typeof modelClass === "function") return modelClass
    }

    return null
  }

  /**
   * Collect every loaded record whose `getModelName()` matches the
   * requested name, walking across the root-level slice plus any
   * preloaded relationships at any depth. Used to evaluate per-record
   * abilities against nested preloaded children with a single batched
   * query per (modelClass, action) pair.
   *
   * @param {import("./database/record/index.js").default[]} rootModels
   * @param {string} modelName
   * @returns {import("./database/record/index.js").default[]}
   */
  _frontendModelCollectRecordsForName(rootModels, modelName) {
    /** @type {import("./database/record/index.js").default[]} */
    const out = []
    /** @type {Set<import("./database/record/index.js").default>} */
    const seen = new Set()

    /** @param {import("./database/record/index.js").default | null | undefined} record */
    const walk = (record) => {
      if (!record || typeof record !== "object") return
      if (seen.has(record)) return
      seen.add(record)

      const ModelClass = typeof record.getModelClass === "function"
        ? record.getModelClass()
        : null
      if (ModelClass && typeof ModelClass.getModelName === "function" && ModelClass.getModelName() === modelName) {
        out.push(record)
      }

      const relationshipsMap = typeof ModelClass?.getRelationshipsMap === "function"
        ? ModelClass.getRelationshipsMap()
        : null
      if (!relationshipsMap) return

      for (const relationshipName of Object.keys(relationshipsMap)) {
        const relationship = typeof record.getRelationshipByName === "function"
          ? record.getRelationshipByName(relationshipName)
          : null
        if (!relationship || typeof relationship.getLoadedOrUndefined !== "function") continue

        const loaded = relationship.getLoadedOrUndefined()
        if (loaded === undefined) continue

        if (Array.isArray(loaded)) {
          for (const child of loaded) walk(child)
        } else {
          walk(loaded)
        }
      }
    }

    for (const root of rootModels) walk(root)

    return out
  }

  /**
   * Evaluate every ability requested via the frontend `abilities`
   * param against the loaded model cohort (plus any preloaded
   * children), attaching the results to each record via
   * `_setComputedAbility`. Runs one batched `authorized query + pluck`
   * per (modelClass, action) pair, regardless of how many records
   * were loaded.
   *
   * @param {import("./database/record/index.js").default[]} rootModels
   * @returns {Promise<void>}
   */
  async frontendModelComputeAbilities(rootModels) {
    const entries = this.frontendModelAbilities()
    if (entries.length === 0) return
    if (!Array.isArray(rootModels) || rootModels.length === 0) return

    const ability = this.currentAbility()
    if (!ability) return

    for (const entry of entries) {
      const modelClass = this._frontendModelClassForAbilities(entry.modelName)
      if (!modelClass) continue

      const candidates = this._frontendModelCollectRecordsForName(rootModels, entry.modelName)
      if (candidates.length === 0) continue

      const primaryKey = modelClass.primaryKey()
      const ids = candidates
        .map((record) => record.readAttribute(primaryKey))
        .filter((value) => value !== null && value !== undefined)
      if (ids.length === 0) continue

      for (const action of entry.actions) {
        let allowedIds
        try {
          const authorizedQuery = modelClass.accessibleFor(action, ability).where({[primaryKey]: ids})
          const plucked = await authorizedQuery.pluck(primaryKey)
          allowedIds = new Set(plucked.map((value) => String(value)))
        } catch (error) {
          // An ability with no allow rules for the action throws via
          // `accessibleFor`; treat as a universal deny so the frontend
          // gets `can(action) === false` for every candidate, instead
          // of surfacing an error that the UI can't act on.
          void error
          allowedIds = new Set()
        }

        for (const record of candidates) {
          const idValue = record.readAttribute(primaryKey)
          const allowed = idValue !== null && idValue !== undefined && allowedIds.has(String(idValue))
          record._setComputedAbility(action, allowed)
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
   *
   * @returns {Array<{modelName: string, actions: string[]}>}
   */
  frontendModelAbilities() {
    const raw = this.frontendModelParams().abilities

    if (!Array.isArray(raw)) return []

    /** @type {Array<{modelName: string, actions: string[]}>} */
    const entries = []

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue
      if (typeof entry.modelName !== "string" || entry.modelName.length === 0) continue
      if (!Array.isArray(entry.actions)) continue

      const actions = entry.actions.filter(
        (/** @type {?} */ action) => typeof action === "string" && action.length > 0
      )

      if (actions.length === 0) continue

      entries.push({actions, modelName: entry.modelName})
    }

    return entries
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
   *
   * @returns {import("./database/query/query-data.js").QueryDataSpec | null}
   */
  frontendModelQueryData() {
    const raw = this.frontendModelParams().queryData

    if (raw == null) return null

    if (typeof raw === "string") return raw
    if (Array.isArray(raw)) return raw
    if (typeof raw === "object") return raw

    return null
  }

  /**
   * @returns {import("./database/query/model-class-query.js").default} - Frontend index query with normalized params applied.
   */
  frontendModelIndexQuery() {
    let query = this.frontendModelAuthorizedQuery("index")
    const preload = this.frontendModelPreload()

    if (preload) {
      query = query.preload(preload)
    }

    const joins = this.frontendModelJoins()
    const where = this.frontendModelWhere()
    const pagination = this.frontendModelPagination()
    const distinct = this.frontendModelDistinct()

    this.applyFrontendModelPagination({pagination, query})

    if (distinct !== null) {
      query.distinct(distinct)
    }

    if (where) {
      this.applyFrontendModelWhere({query, where})
    }

    const ransack = this.frontendModelRansack()

    if (ransack) {
      query.ransack(ransack)
    }

    if (joins) {
      this.applyFrontendModelJoins({joins, query})
    }

    const searches = this.frontendModelSearches()

    for (const search of searches) {
      this.applyFrontendModelSearch({query, search})
    }

    const groups = this.frontendModelGroup()

    if (groups.length > 0) {
      this.applyFrontendModelRootGroupColumns({query})
    }

    for (const group of groups) {
      this.applyFrontendModelGroup({group, query})
    }

    const sorts = this.frontendModelSort()

    if (sorts.length > 0) {
      for (const sort of sorts) {
        this.applyFrontendModelSort({query, sort})
      }
    }

    const withCount = this.frontendModelWithCount()

    for (const entry of withCount) {
      /** @type {Record<string, boolean | {relationship?: string, where?: Record<string, ?>}>} */
      const spec = {}
      spec[entry.attributeName] = {relationship: entry.relationshipName, where: entry.where}
      query.withCount(spec)
    }

    const queryData = this.frontendModelQueryData()

    if (queryData != null) {
      query.queryData(queryData)
    }

    query = this.applyFrontendModelTranslatedAttributePreloads({query})

    if (query._distinct && query.driver.getType() === "mssql") {
      return this.frontendModelMssqlDistinctByPrimaryKeyQuery({query})
    }

    return query
  }

  /**
   * MSSQL cannot apply DISTINCT over non-comparable text columns in table.* selects.
   * This rewrites distinct frontend-model queries to select root records by distinct PK subquery.
   * @param {object} args - Args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query with distinct and filters.
   * @returns {import("./database/query/model-class-query.js").default} - MSSQL-safe distinct query.
   */
  frontendModelMssqlDistinctByPrimaryKeyQuery({query}) {
    const modelClass = this.frontendModelClass()
    const primaryKey = modelClass.primaryKey()
    const rootTableSql = query.driver.quoteTable(modelClass.tableName())
    const primaryKeySql = `${rootTableSql}.${query.driver.quoteColumn(primaryKey)}`
    const distinctIdsQuery = query.clone()

    distinctIdsQuery._preload = {}
    distinctIdsQuery._selects = []
    distinctIdsQuery.select(primaryKeySql)
    distinctIdsQuery.distinct(true)

    const distinctRootQuery = modelClass._newQuery()

    distinctRootQuery.where(`${primaryKeySql} IN (${distinctIdsQuery.toSql()})`)
    distinctRootQuery._preload = {...query._preload}

    return distinctRootQuery
  }

  /**
   * @param {object} args - Pluck args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelPluck[]} args.pluck - Pluck descriptors.
   * @returns {Promise<Array<?>>} - Plucked values.
   */
  async frontendModelPluckValues({query, pluck}) {
    if (pluck.length < 1) {
      throw new Error("No columns given to pluck")
    }

    const modelClass = this.frontendModelClass()
    const pluckQuery = query.clone()
    /** @type {string[]} */
    const aliases = []
    const queryMetadata = frontendModelQueryMetadata(query)
    const pluckQueryMetadata = frontendModelQueryMetadata(pluckQuery)
    const joinedPaths = queryMetadata[frontendModelJoinedPathsSymbol]

    pluckQuery._preload = {}
    pluckQuery._selects = []
    pluckQueryMetadata[frontendModelJoinedPathsSymbol] = joinedPaths ? new Set(joinedPaths) : new Set()

    for (const [pluckIndex, pluckEntry] of pluck.entries()) {
      const targetModelClass = this.frontendModelSearchTargetModelClass({
        modelClass,
        path: pluckEntry.path
      })
      const columnName = this.resolveFrontendModelColumnName(targetModelClass, pluckEntry.column)

      if (!columnName) {
        throw new Error(`Unknown pluck column "${pluckEntry.column}" for ${targetModelClass.name}`)
      }

      if (pluckEntry.path.length > 0) {
        this.ensureFrontendModelJoinPath({path: pluckEntry.path, query: pluckQuery})
      }

      const tableReference = pluckQuery.getTableReferenceForJoin(...pluckEntry.path)
      const columnSql = `${pluckQuery.driver.quoteTable(tableReference)}.${pluckQuery.driver.quoteColumn(columnName)}`
      const alias = `frontend_model_pluck_${pluckIndex}`

      pluckQuery.select(`${columnSql} AS ${pluckQuery.driver.quoteColumn(alias)}`)
      aliases.push(alias)
    }

    const rows = await pluckQuery.results()

    if (aliases.length === 1) {
      const [alias] = aliases

      return rows.map((row) => /** @type {Record<string, ?>} */ (row)[alias])
    }

    return rows.map((row) => {
      const rowHash = /** @type {Record<string, ?>} */ (row)

      return aliases.map((alias) => rowHash[alias])
    })
  }

  /**
   * @param {object} args - Search args.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Root model class.
   * @param {string[]} args.path - Relationship path.
   * @returns {typeof import("./database/record/index.js").default} - Target model class.
   */
  frontendModelSearchTargetModelClass({modelClass, path}) {
    let targetModelClass = modelClass

    for (const relationshipName of path) {
      const relationship = targetModelClass.getRelationshipsMap()[relationshipName]

      if (!relationship) {
        throw new Error(`Unknown search relationship "${relationshipName}" for ${targetModelClass.name}`)
      }

      const relationshipTargetModelClass = relationship.getTargetModelClass()

      if (!relationshipTargetModelClass) {
        throw new Error(`No target model class for ${targetModelClass.name}#${relationshipName}`)
      }

      targetModelClass = relationshipTargetModelClass
    }

    return targetModelClass
  }

  /**
   * @param {object} args - Search args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelSearch} args.search - Search filter.
   * @returns {void}
   */
  applyFrontendModelSearch({query, search}) {
    const modelClass = this.frontendModelClass()
    const targetModelClass = this.frontendModelSearchTargetModelClass({
      modelClass,
      path: search.path
    })
    const columnName = this.resolveFrontendModelColumnName(targetModelClass, search.column)

    if (!columnName) {
      throw new Error(`Unknown search column "${search.column}" for ${targetModelClass.name}`)
    }

    if (search.path.length > 0) {
      this.ensureFrontendModelJoinPath({path: search.path, query})
    }

    const tableReference = query.getTableReferenceForJoin(...search.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`
    const operatorMap = {
      eq: "=",
      gt: ">",
      gteq: ">=",
      like: "LIKE",
      lt: "<",
      lteq: "<=",
      notEq: "!="
    }
    const sqlOperator = operatorMap[search.operator]

    if (search.operator === "eq") {
      if (this.applyFrontendModelArraySearch({emptySql: "1=0", operatorSql: "IN", query, search, columnSql})) return

      if (search.value === null) {
        query.where(`${columnSql} IS NULL`)
        return
      }
    }

    if (search.operator === "notEq") {
      if (this.applyFrontendModelArraySearch({emptySql: "1=1", operatorSql: "NOT IN", query, search, columnSql})) return

      if (search.value === null) {
        query.where(`${columnSql} IS NOT NULL`)
        return
      }
    }

    query.where(`${columnSql} ${sqlOperator} ${query.driver.quote(search.value)}`)
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
  applyFrontendModelArraySearch({columnSql, emptySql, operatorSql, query, search}) {
    if (!Array.isArray(search.value)) return false

    if (search.value.length === 0) {
      query.where(emptySql)
    } else {
      query.where(`${columnSql} ${operatorSql} (${search.value.map((entry) => query.driver.quote(entry)).join(", ")})`)
    }

    return true
  }

  /**
   * @param {object} args - Pagination args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelPagination} args.pagination - Pagination values.
   * @returns {void}
   */
  applyFrontendModelPagination({query, pagination}) {
    if (pagination.limit !== null) {
      query.limit(pagination.limit)
    }

    if (pagination.offset !== null) {
      query.offset(pagination.offset)
    }

    if (pagination.perPage !== null) {
      query.perPage(pagination.perPage)
    }

    if (pagination.page !== null) {
      query.page(pagination.page)
    }
  }

  /**
   * @param {object} args - Where args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {Record<string, ?>} args.where - Root-model where conditions.
   * @returns {void}
   */
  applyFrontendModelWhere({query, where}) {
    this.applyFrontendModelWhereForPath({
      modelClass: this.frontendModelClass(),
      path: [],
      query,
      where
    })
  }

  /**
   * @param {object} args - Joins args.
   * @param {Record<string, ?>} args.joins - Relationship-object joins.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelJoins({joins, query}) {
    const joinPathKeys = new Set()

    this.applyFrontendModelJoinsForPath({
      joins,
      joinPathKeys,
      modelClass: this.frontendModelClass(),
      path: [],
      query
    })

    query.joins(joins)

    const queryMetadata = frontendModelQueryMetadata(query)
    const joinedPaths = queryMetadata[frontendModelJoinedPathsSymbol] || new Set()

    for (const joinPathKey of joinPathKeys) {
      joinedPaths.add(joinPathKey)
    }

    queryMetadata[frontendModelJoinedPathsSymbol] = joinedPaths
  }

  /**
   * @param {object} args - Joins args.
   * @param {Record<string, ?>} args.joins - Joins for current path.
   * @param {Set<string>} args.joinPathKeys - Joined path keys.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current path.
   * @param {string[]} args.path - Relationship path.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelJoinsForPath({joins, joinPathKeys, modelClass, path, query}) {
    void query

    for (const [relationshipName, relationshipJoin] of Object.entries(joins)) {
      const relationship = modelClass.getRelationshipsMap()[relationshipName]

      if (!relationship) {
        throw new Error(`Unknown join relationship "${relationshipName}" for ${modelClass.name}`)
      }

      const targetModelClass = relationship.getTargetModelClass()

      if (!targetModelClass) {
        throw new Error(`No target model class for join relationship "${relationshipName}" on ${modelClass.name}`)
      }

      const relationshipPath = [...path, relationshipName]
      joinPathKeys.add(relationshipPath.join("."))

      if (relationshipJoin === true) continue

      this.applyFrontendModelJoinsForPath({
        joins: relationshipJoin,
        joinPathKeys,
        modelClass: targetModelClass,
        path: relationshipPath,
        query
      })
    }
  }

  /**
   * Resolves a key that may be either a camelCase attribute name or a raw DB
   * column name to its canonical column name.  Returns `undefined` when the
   * key matches neither map.
   *
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @param {string} key - Attribute name or column name to resolve.
   * @returns {string | undefined} - Resolved DB column name, or `undefined`.
   */
  resolveFrontendModelColumnName(modelClass, key) {
    const attributeNameToColumnNameMap = modelClass.getAttributeNameToColumnNameMap()
    const columnName = attributeNameToColumnNameMap[key]

    if (columnName) return columnName

    // Fall back: check whether the key is already a raw DB column name.
    const columnNameToAttributeNameMap = modelClass.getColumnNameToAttributeNameMap()

    if (columnNameToAttributeNameMap[key]) return key

    return undefined
  }

  /**
   * @param {object} args - Where args.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current where scope.
   * @param {string[]} args.path - Relationship path from root.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {Record<string, ?>} args.where - Where conditions for current scope.
   * @returns {void}
   */
  applyFrontendModelWhereForPath({modelClass, path, query, where}) {
    for (const [attributeName, value] of Object.entries(where)) {
      const columnName = this.resolveFrontendModelColumnName(modelClass, attributeName)

      if (columnName) {
        this.ensureFrontendModelJoinPath({path, query})

        const tableReference = query.getTableReferenceForJoin(...path)
        const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`

        if (Array.isArray(value)) {
          if (value.length === 0) {
            query.where("1=0")
          } else {
            const normalizedValues = value.map((entry) => this.normalizeFrontendModelWhereColumnValue({columnName, modelClass, value: entry}))

            if (normalizedValues.includes(frontendModelWhereNoMatchSymbol)) {
              query.where("1=0")
            } else {
              query.where(`${columnSql} IN (${normalizedValues.map((entry) => query.driver.quote(entry)).join(", ")})`)
            }
          }

          continue
        }

        if (value == null) {
          query.where(`${columnSql} IS NULL`)
        } else {
          const normalizedValue = this.normalizeFrontendModelWhereColumnValue({columnName, modelClass, value})

          if (normalizedValue === frontendModelWhereNoMatchSymbol) {
            query.where("1=0")
          } else {
            query.where(`${columnSql} = ${query.driver.quote(normalizedValue)}`)
          }
        }

        continue
      }

      if (isPlainObject(value)) {
        const relationship = modelClass.getRelationshipsMap()[attributeName]

        if (!relationship) {
          throw new Error(`Unknown where relationship "${attributeName}" for ${modelClass.name}`)
        }

        const targetModelClass = relationship.getTargetModelClass()

        if (!targetModelClass) {
          throw new Error(`No target model class for where relationship "${attributeName}" on ${modelClass.name}`)
        }

        const relationshipPath = [...path, attributeName]

        this.applyFrontendModelWhereForPath({
          modelClass: targetModelClass,
          path: relationshipPath,
          query,
          where: value
        })

        continue
      }

      throw new Error(`Unknown where column "${attributeName}" for ${modelClass.name}`)
    }
  }

  /**
   * @param {object} args - Args.
   * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
   * @param {string} args.columnName - Column name.
   * @param {?} args.value - Where value.
   * @returns {? | symbol} - SQL-safe where value.
   */
  normalizeFrontendModelWhereColumnValue({columnName, modelClass, value}) {
    if (typeof value === "string") {
      const columnType = modelClass.getColumnTypeByName(columnName)?.toLowerCase()
      const isDateTimeColumn = typeof columnType === "string" && ["date", "datetime", "timestamp"].some((type) => columnType.includes(type))

      if (isDateTimeColumn) {
        const parsedDate = new Date(value)

        if (!Number.isNaN(parsedDate.getTime())) {
          return parsedDate
        }
      }
    }

    if (isPlainObject(value)) {
      const columnType = modelClass.getColumnTypeByName(columnName)

      if (typeof columnType !== "string") {
        return frontendModelWhereNoMatchSymbol
      }

      const normalizedType = columnType.toLowerCase()
      const objectValueTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"])
      const supportsObjectValues = normalizedType.includes("text") || objectValueTypes.has(normalizedType)

      if (!supportsObjectValues) {
        return frontendModelWhereNoMatchSymbol
      }

      return JSON.stringify(value)
    }

    return value
  }

  /**
   * @param {object} args - Group args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelGroup} args.group - Group definition.
   * @returns {void}
   */
  applyFrontendModelGroup({query, group}) {
    const modelClass = this.frontendModelClass()
    const targetModelClass = this.frontendModelSearchTargetModelClass({
      modelClass,
      path: group.path
    })
    const columnName = this.resolveFrontendModelColumnName(targetModelClass, group.column)

    if (!columnName) {
      throw new Error(`Unknown group column "${group.column}" for ${targetModelClass.name}`)
    }

    this.ensureFrontendModelJoinPath({path: group.path, query})

    const tableReference = query.getTableReferenceForJoin(...group.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`

    this.ensureFrontendModelGroupColumn({columnSql, query})
  }

  /**
   * Adds root-model columns to GROUP BY so strict SQL engines accept default root-table selects.
   * @param {object} args - Args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  applyFrontendModelRootGroupColumns({query}) {
    const modelClass = this.frontendModelClass()
    const attributeNameToColumnNameMap = modelClass.getAttributeNameToColumnNameMap()
    const rootTableReference = query.getTableReferenceForJoin()

    for (const columnName of Object.values(attributeNameToColumnNameMap)) {
      const columnSql = `${query.driver.quoteTable(rootTableReference)}.${query.driver.quoteColumn(columnName)}`

      this.ensureFrontendModelGroupColumn({columnSql, query})
    }
  }

  /**
   * Ensures a group-by SQL column is only appended once.
   * @param {object} args - Args.
   * @param {string} args.columnSql - Fully-qualified column SQL.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  ensureFrontendModelGroupColumn({columnSql, query}) {
    const queryMetadata = frontendModelQueryMetadata(query)
    const groupedColumns = queryMetadata[frontendModelGroupedColumnsSymbol] || new Set()

    if (groupedColumns.has(columnSql)) return

    query.group(columnSql)
    groupedColumns.add(columnSql)
    queryMetadata[frontendModelGroupedColumnsSymbol] = groupedColumns
  }

  /**
   * @param {object} args - Args.
   * @param {import("./database/query/model-class-query.js").default<?>} args.query - Query instance.
   * @returns {import("./database/query/model-class-query.js").default<?>} - Query with translations preloaded if needed.
   */
  applyFrontendModelTranslatedAttributePreloads({query}) {
    const modelClass = this.frontendModelClass()
    const selectedAttributes = this.frontendModelEffectiveSelectedAttributesForModelClass(modelClass, this.frontendModelDefaultAttributesForModelClass(modelClass) || [])
      || this.frontendModelDefaultAttributesForModelClass(modelClass)

    if (!selectedAttributes) return query

    const resource = this.frontendModelResourceInstance()
    const resourceClass = /** @type {typeof import("./frontend-model-resource/base-resource.js").default} */ (resource.constructor)
    const translatedSet = new Set(resourceClass.translatedAttributes || [])
    let needsTranslations = false

    for (const attributeName of selectedAttributes) {
      const hookName = `${attributeName}AttributeSelected`
      const dynamicResource = /** @type {Record<string, ?>} */ (/** @type {?} */ (resource))

      if (typeof dynamicResource[hookName] === "function") {
        const result = dynamicResource[hookName]({query})

        if (result) {
          query = result
        }
      } else if (translatedSet.has(attributeName)) {
        needsTranslations = true
      }
    }

    if (needsTranslations) {
      query = query.preload({translations: {}})
    }

    return query
  }

  /**
   * @param {object} args - Sort args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {FrontendModelSort} args.sort - Sort definition.
   * @returns {void}
   */
  applyFrontendModelSort({query, sort}) {
    const modelClass = this.frontendModelClass()
    const targetModelClass = this.frontendModelSearchTargetModelClass({
      modelClass,
      path: sort.path
    })
    const translatedAttributesMap = targetModelClass.getTranslationsMap()
    const translatedAttributeNames = Object.keys(translatedAttributesMap)
    const isTranslatedSortAttribute = translatedAttributeNames.includes(sort.column)

    const columnName = this.resolveFrontendModelColumnName(targetModelClass, sort.column)
    const direction = sort.direction.toUpperCase()

    if (isTranslatedSortAttribute) {
      const translationModelClass = targetModelClass.getTranslationClass()
      const translationAttributeNameToColumnNameMap = translationModelClass.getAttributeNameToColumnNameMap()
      const translationColumnName = translationAttributeNameToColumnNameMap[sort.column]
      const translationPath = sort.path.concat(["currentTranslation"])

      if (!translationColumnName) {
        throw new Error(`Unknown translated sort column "${sort.column}" for ${targetModelClass.name}`)
      }

      this.ensureFrontendModelSortJoinPath({path: translationPath, query})

      const translationTableReference = query.getTableReferenceForJoin(...translationPath)
      const translationColumnSql = `${query.driver.quoteTable(translationTableReference)}.${query.driver.quoteColumn(translationColumnName)}`

      query.order(`${translationColumnSql} ${direction}`)

      return
    }

    if (!columnName) {
      throw new Error(`Unknown sort column "${sort.column}" for ${targetModelClass.name}`)
    }

    this.ensureFrontendModelSortJoinPath({path: sort.path, query})

    const tableReference = query.getTableReferenceForJoin(...sort.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`

    query.order(`${columnSql} ${direction}`)
  }

  /**
   * Ensures a sort join path has been joined on query.
   * @param {object} args - Join args.
   * @param {string[]} args.path - Relationship join path.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  ensureFrontendModelSortJoinPath({path, query}) {
    this.ensureFrontendModelJoinPath({path, query})
  }

  /**
   * Ensures a relationship path has exactly one SQL join.
   * @param {object} args - Join args.
   * @param {string[]} args.path - Relationship join path.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @returns {void}
   */
  ensureFrontendModelJoinPath({path, query}) {
    if (path.length < 1) return

    const queryMetadata = frontendModelQueryMetadata(query)
    const joinedPaths = queryMetadata[frontendModelJoinedPathsSymbol] || new Set()
    const pathKey = path.join(".")

    if (joinedPaths.has(pathKey)) return

    query.joins(buildFrontendModelJoinObjectFromPath(path))
    joinedPaths.add(pathKey)
    queryMetadata[frontendModelJoinedPathsSymbol] = joinedPaths
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {string[] | null} - Selected attributes for model class.
   */
  frontendModelSelectedAttributesForModelClass(modelClass) {
    const select = this.frontendModelSelect()

    if (!select) return null

    return select[modelClass.getModelName()] || null
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {string[] | null} - Extra attributes (loaded in addition to the defaults) for the model class.
   */
  frontendModelSelectsExtraForModelClass(modelClass) {
    const selectsExtra = this.frontendModelSelectsExtra()

    if (!selectsExtra) return null

    return selectsExtra[modelClass.getModelName()] || null
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
    const selectedAttributes = this.frontendModelSelectedAttributesForModelClass(modelClass)

    if (selectedAttributes) return selectedAttributes

    const extraAttributes = this.frontendModelSelectsExtraForModelClass(modelClass)

    if (!extraAttributes) return null

    const defaultAttributes = this.frontendModelDefaultAttributesForModelClass(modelClass) || fallbackAttributeNames

    return Array.from(new Set([...defaultAttributes, ...extraAttributes]))
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {string[] | null} - Default frontend-model attributes declared on the resource.
   */
  frontendModelDefaultAttributesForModelClass(modelClass) {
    const frontendModelResource = this.frontendModelResourceConfigurationForModelClass(modelClass)
    const attributes = frontendModelResource?.resourceConfiguration.attributes

    if (!attributes) return null

    if (Array.isArray(attributes)) {
      return attributes
        .filter((entry) => {
          if (typeof entry === "string") return true

          const config = /** @type {Record<string, ?>} */ (entry)

          if (config && config.selectedByDefault === false) return false

          return true
        })
        .map((entry) => typeof entry === "string" ? entry : /** @type {Record<string, ?>} */ (entry).name)
    }

    if (typeof attributes === "object") {
      return Object.entries(attributes)
        .filter(([, config]) => {
          if (!config || typeof config !== "object") return true

          return /** @type {Record<string, ?>} */ (config).selectedByDefault !== false
        })
        .map(([name]) => name)
    }

    return null
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {string[]} - Attribute names explicitly marked selectedByDefault: false.
   */
  frontendModelNonDefaultAttributesForModelClass(modelClass) {
    const frontendModelResource = this.frontendModelResourceConfigurationForModelClass(modelClass)
    const attributes = frontendModelResource?.resourceConfiguration.attributes

    if (!attributes) return []

    if (Array.isArray(attributes)) {
      return attributes
        .filter((entry) => {
          if (typeof entry !== "object" || !entry) return false

          return /** @type {Record<string, ?>} */ (entry).selectedByDefault === false
        })
        .map((entry) => /** @type {Record<string, ?>} */ (/** @type {?} */ (entry)).name)
    }

    if (typeof attributes === "object") {
      return Object.entries(attributes)
        .filter(([, config]) => typeof config === "object" && config && /** @type {Record<string, ?>} */ (config).selectedByDefault === false)
        .map(([name]) => name)
    }

    return []
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {Promise<Record<string, ?>>} - Serialized attributes filtered by select map.
   */
  async serializeFrontendModelAttributes(model) {
    const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
    const modelAttributes = model.attributes()
    const selectedAttributes = this.frontendModelEffectiveSelectedAttributesForModelClass(modelClass, Object.keys(modelAttributes))
    const defaultAttributes = this.frontendModelDefaultAttributesForModelClass(modelClass)
    const resourceInstance = this._serializationResourceInstanceForModel(model)

    /** @param {string} attributeName - Attribute name. */
    const resourceAttributeMethodName = (attributeName) => `${attributeName}Attribute`

    /** @param {string} attributeName - Attribute name. */
    const resourceHasAttribute = (attributeName) => {
      const methodName = resourceAttributeMethodName(attributeName)

      return resourceInstance && typeof /** @type {Record<string, ?>} */ (/** @type {?} */ (resourceInstance))[methodName] === "function"
    }

    /** @param {string} attributeName - Attribute name. */
    const prototypeAttributeMethod = (attributeName) => {
      let currentPrototype = Object.getPrototypeOf(model)

      while (currentPrototype && currentPrototype !== Object.prototype) {
        const candidate = Object.getOwnPropertyDescriptor(currentPrototype, attributeName)?.value

        if (typeof candidate === "function") {
          return {
            method: candidate,
            ownerName: currentPrototype.constructor?.name
          }
        }

        currentPrototype = Object.getPrototypeOf(currentPrototype)
      }
    }

    /** @param {string} attributeName - Attribute name. */
    const serializedAttributeValue = async (attributeName) => {
      // Check resource instance first (virtual/computed attributes via ${name}Attribute convention)
      if (resourceHasAttribute(attributeName)) {
        const methodName = resourceAttributeMethodName(attributeName)

        return await /** @type {Record<string, Function>} */ (/** @type {?} */ (resourceInstance))[methodName](model)
      }

      // Fall back to model method
      const attributeMethodLookup = prototypeAttributeMethod(attributeName)
      const attributeMethod = attributeMethodLookup?.method

      if (typeof attributeMethod === "function") {
        return await attributeMethod.call(model)
      }

      return modelAttributes[attributeName]
    }

    /** @param {string} attributeName - Attribute name. */
    const attributeExists = (attributeName) => {
      return (attributeName in modelAttributes) || (attributeName in /** @type {Record<string, ?>} */ (model)) || resourceHasAttribute(attributeName)
    }

    if (!selectedAttributes) {
      if (!defaultAttributes || defaultAttributes.length < 1) {
        return modelAttributes
      }

      const excludedAttributes = this.frontendModelNonDefaultAttributesForModelClass(modelClass)
      const serializedAttributes = {...modelAttributes}

      for (const excludedName of excludedAttributes) {
        delete serializedAttributes[excludedName]
      }

      for (const attributeName of defaultAttributes) {
        if (!attributeExists(attributeName)) continue
        serializedAttributes[attributeName] = await serializedAttributeValue(attributeName)
      }

      return serializedAttributes
    }

    /** @type {Record<string, ?>} */
    const serializedAttributes = {}

    for (const attributeName of selectedAttributes) {
      if (!attributeExists(attributeName)) continue
      serializedAttributes[attributeName] = await serializedAttributeValue(attributeName)
    }

    return serializedAttributes
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {import("./frontend-model-resource/base-resource.js").default | null} - Resource instance or null.
   */
  _serializationResourceInstanceForModel(model) {
    const resource = this.frontendModelResourceInstance()

    if (resource.modelClass() === model.constructor) {
      return resource
    }

    const configuration = this.getConfiguration()
    const backendProjects = configuration.getBackendProjects?.() || []
    const modelClassName = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor).getModelName()

    for (const backendProject of backendProjects) {
      const resources = frontendModelResourcesForBackendProject(backendProject)
      const resourceDefinition = resources[modelClassName]
      const resourceClass = resourceDefinition ? frontendModelResourceClassFromDefinition(resourceDefinition) : null

      if (resourceClass) {
        return new resourceClass({
          ability: this.currentAbility(),
          context: this.currentAbility()?.getContext() || {},
          locals: this.currentAbility()?.getLocals() || {},
          modelClass: /** @type {typeof import("./database/record/index.js").default} */ (model.constructor),
          modelName: modelClassName,
          params: {},
          resourceConfiguration: /** @type {import("./configuration-types.js").FrontendModelResourceConfiguration | undefined} */ (typeof resourceClass.resourceConfig === "function" ? resourceClass.resourceConfig() : undefined)
        })
      }
    }

    return null
  }

  /**
   * @param {object} args - Arguments.
   * @param {import("./database/record/index.js").default[]} args.models - Frontend model records.
   * @param {boolean} args.relationshipIsCollection - Whether relation is has-many.
   * @returns {Promise<import("./database/record/index.js").default[]>} - Serializable related models.
   */
  async frontendModelFilterSerializableRelatedModels({models, relationshipIsCollection}) {
    if (!this.currentAbility()) return models
    if (models.length === 0) return models

    /** @type {Map<typeof import("./database/record/index.js").default, import("./database/record/index.js").default[]>} */
    const modelsByClass = new Map()

    for (const model of models) {
      const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
      const existingModelsForClass = modelsByClass.get(relatedModelClass) || []

      existingModelsForClass.push(model)
      modelsByClass.set(relatedModelClass, existingModelsForClass)
    }

    /** @type {Map<typeof import("./database/record/index.js").default, Set<string>>} */
    const authorizedIdsByClass = new Map()
    /** @type {Map<typeof import("./database/record/index.js").default, string>} */
    const primaryKeysByClass = new Map()

    for (const [relatedModelClass, relatedModels] of modelsByClass.entries()) {
      const relatedResource = this.frontendModelResourceConfigurationForModelClass(relatedModelClass)

      if (!relatedResource) {
        authorizedIdsByClass.set(relatedModelClass, new Set())
        continue
      }

      const abilityAction = relationshipIsCollection
        ? relatedResource.resourceConfiguration.abilities?.index
        : relatedResource.resourceConfiguration.abilities?.find

      if (typeof abilityAction !== "string" || abilityAction.length < 1) {
        authorizedIdsByClass.set(relatedModelClass, new Set())
        continue
      }

      const primaryKey = relatedModelClass.primaryKey()
      const ids = relatedModels
        .map((model) => model.attributes()[primaryKey])
        .filter((id) => id !== undefined && id !== null)

      if (ids.length < 1) {
        authorizedIdsByClass.set(relatedModelClass, new Set())
        continue
      }

      const authorizedIdsRaw = await relatedModelClass
        .accessibleFor(abilityAction)
        .where({[primaryKey]: ids})
        .pluck(primaryKey)

      primaryKeysByClass.set(relatedModelClass, primaryKey)
      authorizedIdsByClass.set(relatedModelClass, new Set(authorizedIdsRaw.map((id) => String(id))))
    }

    return models.filter((model) => {
      const relatedModelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
      const authorizedIds = authorizedIdsByClass.get(relatedModelClass)
      const primaryKey = primaryKeysByClass.get(relatedModelClass)

      if (!authorizedIds || !primaryKey) return false

      const primaryKeyValue = model.attributes()[primaryKey]

      if (primaryKeyValue === undefined || primaryKeyValue === null) return false

      return authorizedIds.has(String(primaryKeyValue))
    })
  }

  /**
   * @param {?} value - Candidate preloaded value.
   * @returns {value is import("./database/record/index.js").default} - Whether value behaves like a model.
   */
  isSerializableFrontendModel(value) {
    return Boolean(value && typeof value === "object" && typeof /** @type {?} */ (value).attributes === "function")
  }

  /**
   * @param {import("./database/record/index.js").default[]} models - Models to serialize.
   * @returns {Promise<Record<string, ?>[]>} - Serialized model payloads.
   */
  async serializeFrontendModels(models) {
    if (models.length < 1) return []

    /** @type {Array<Record<string, ?>>} */
    const preloadedRelationshipsPerModel = Array.from({length: models.length}, () => ({}))

    /** @type {Array<{loadedModels: import("./database/record/index.js").default[], modelIndex: number, relationshipName: string}>} */
    const collectionRelationshipEntries = []
    /** @type {Array<{loadedModel: import("./database/record/index.js").default, modelIndex: number, relationshipName: string}>} */
    const singularRelationshipEntries = []

    models.forEach((model, modelIndex) => {
      const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
      const relationshipsMap = modelClass.getRelationshipsMap()

      for (const relationshipName in relationshipsMap) {
        const relationship = model.getRelationshipByName(relationshipName)

        if (!relationship.getPreloaded()) continue

        const loadedRelationship = relationship.loaded()

        if (Array.isArray(loadedRelationship)) {
          collectionRelationshipEntries.push({loadedModels: loadedRelationship, modelIndex, relationshipName})
          continue
        }

        if (this.isSerializableFrontendModel(loadedRelationship)) {
          singularRelationshipEntries.push({loadedModel: loadedRelationship, modelIndex, relationshipName})
          continue
        }

        preloadedRelationshipsPerModel[modelIndex][relationshipName] = loadedRelationship == undefined ? null : loadedRelationship
      }
    })

    if (collectionRelationshipEntries.length > 0) {
      const allCollectionModels = collectionRelationshipEntries.flatMap((entry) => entry.loadedModels)
      const serializableCollectionModels = await this.frontendModelFilterSerializableRelatedModels({
        models: allCollectionModels,
        relationshipIsCollection: true
      })
      const serializableCollectionModelsSet = new Set(serializableCollectionModels)

      for (const relationshipEntry of collectionRelationshipEntries) {
        const allowedModels = relationshipEntry.loadedModels.filter((relatedModel) => serializableCollectionModelsSet.has(relatedModel))
        const serializedRelatedModels = await this.serializeFrontendModels(allowedModels)

        preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = serializedRelatedModels
      }
    }

    if (singularRelationshipEntries.length > 0) {
      const allSingularModels = singularRelationshipEntries.map((entry) => entry.loadedModel)
      const serializableSingularModels = await this.frontendModelFilterSerializableRelatedModels({
        models: allSingularModels,
        relationshipIsCollection: false
      })
      const serializableSingularModelsSet = new Set(serializableSingularModels)

      for (const relationshipEntry of singularRelationshipEntries) {
        if (!serializableSingularModelsSet.has(relationshipEntry.loadedModel)) {
          preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = null
          continue
        }

        const serializedModel = (await this.serializeFrontendModels([relationshipEntry.loadedModel]))[0]
        preloadedRelationshipsPerModel[relationshipEntry.modelIndex][relationshipEntry.relationshipName] = serializedModel
      }
    }

    /** @type {Record<string, ?>[]} */
    const serializedModels = []

    for (const [modelIndex, model] of models.entries()) {
      const serializedAttributes = await this.serializeFrontendModelAttributes(model)
      const preloadedRelationships = preloadedRelationshipsPerModel[modelIndex]
      const associationCounts = typeof model.associationCounts === "function"
        ? model.associationCounts()
        : {}
      const queryDataValues = typeof model.queryDataValues === "function"
        ? model.queryDataValues()
        : {}
      const computedAbilities = typeof model.computedAbilities === "function"
        ? model.computedAbilities()
        : {}
      const hasCounts = Object.keys(associationCounts).length > 0
      const hasQueryData = Object.keys(queryDataValues).length > 0
      const hasAbilities = Object.keys(computedAbilities).length > 0
      const hasPreloaded = Object.keys(preloadedRelationships).length > 0

      if (!hasPreloaded && !hasCounts && !hasQueryData && !hasAbilities) {
        serializedModels.push(serializedAttributes)
        continue
      }

      /** @type {Record<string, ?>} */
      const serialized = {...serializedAttributes}

      if (hasPreloaded) serialized.__preloadedRelationships = preloadedRelationships
      if (hasCounts) serialized.__associationCounts = associationCounts
      if (hasQueryData) serialized.__queryData = queryDataValues
      if (hasAbilities) serialized.__abilities = computedAbilities

      serializedModels.push(serialized)
    }

    return serializedModels
  }

  /**
   * @param {import("./database/record/index.js").default} model - Frontend model record.
   * @returns {Promise<Record<string, ?>>} - Serialized frontend model payload.
   */
  async serializeFrontendModel(model) {
    const serializedModels = await this.serializeFrontendModels([model])

    return serializedModels[0]
  }

  /**
   * @param {string} errorMessage - Error message.
   * @returns {Promise<void>} - Resolves when error has been rendered.
   */
  async frontendModelRenderError(errorMessage) {
    await this.logger.error(`Frontend model request failed: ${errorMessage}`)

    const renderError = /** @type {((errorMessage: string) => Promise<void>) | undefined} */ (
      /** @type {?} */ (this).renderError
    )

    if (typeof renderError === "function") {
      await renderError.call(this, frontendModelClientSafeErrorMessage)
      return
    }

    await this.render({
      json: /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue({
        errorMessage: frontendModelClientSafeErrorMessage,
        status: "error"
      }))
    })
  }

  /**
   * @param {string} errorMessage - Error message.
   * @returns {Record<string, ?>} - Error payload.
   */
  frontendModelErrorPayload(errorMessage) {
    return {
      errorMessage,
      status: "error"
    }
  }

  /**
   * @returns {Record<string, ?>} - Client-safe error payload.
   */
  frontendModelClientSafeErrorPayload() {
    return this.frontendModelErrorPayload(frontendModelClientSafeErrorMessage)
  }

  /**
   * @param {?} error - Caught error.
   * @returns {Record<string, ?>} - Client payload for the current environment.
   */
  frontendModelClientErrorPayloadForError(error) {
    const velociousMetadata = frontendModelVelociousMetadataForError(error)

    let validationErrorsPayload = {}

    if (error instanceof ValidationError) {
      const validationErrors = error.getValidationErrors()
      const model = error.getModel()
      /** @type {Record<string, {type: string, message: string, fullMessage: string}[]>} */
      const structuredErrors = {}

      for (const attributeName in validationErrors) {
        structuredErrors[attributeName] = validationErrors[attributeName].map(err => ({
          type: err.type,
          message: err.message,
          fullMessage: `${model.getModelClass().humanAttributeName(attributeName)} ${err.message}`
        }))
      }

      validationErrorsPayload = {
        errorType: "validation_error",
        validationErrors: structuredErrors
      }
    }

    return {
      ...this.frontendModelErrorPayload(frontendModelClientMessageForError(error)),
      ...frontendModelDebugPayloadForError({
        configuration: this.getConfiguration(),
        environment: this.getConfiguration().getEnvironment(),
        error
      }),
      ...(velociousMetadata ? {velocious: velociousMetadata} : {}),
      ...validationErrorsPayload
    }
  }

  /**
   * @param {object} args - Error log args.
   * @param {string} args.action - Endpoint/action label.
   * @param {?} args.error - Caught error.
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url" | "custom-command"} [args.commandType] - Frontend-model command type.
   * @param {string | undefined} [args.model] - Request model name when available.
   * @param {string | undefined} [args.requestId] - Batch request id when available.
   * @returns {Promise<void>} - Resolves after logging.
   */
  async frontendModelLogEndpointError({action, error, commandType, model, requestId}) {
    // Errors annotated with `error.velocious = {...}` are user-flow
    // failures the developer has marked as expected (bad password,
    // validation message, etc.). Surface the message + metadata to
    // the client (handled by frontendModelClientErrorPayloadForError),
    // but skip the error log so monitoring stays focused on real
    // backend failures.
    if (frontendModelErrorHasVelociousMetadata(error)) return

    let resolvedModel = model

    if (!resolvedModel) {
      try {
        resolvedModel = this.frontendModelParams().model
      } catch {
        resolvedModel = undefined
      }
    }

    const errorMessage = error instanceof Error
      ? `${error.message}\n${error.stack || ""}`
      : String(error)

    await this.logger.error(() => ["Frontend model endpoint request failed", {
      action,
      commandType,
      error: errorMessage,
      model: resolvedModel,
      requestId
    }])
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Frontend action.
   * @returns {Promise<void>} - Resolves when response has been rendered.
   */
  async frontendModelRenderCommandResponse(action) {
    try {
      const responsePayload = await this.frontendModelCommandPayload(action)
      if (!responsePayload) return

      await this.render({
        json: /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue(responsePayload))
      })
    } catch (error) {
      await this.frontendModelLogEndpointError({action, commandType: action, error})

      await this.render({
        json: /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue(this.frontendModelClientErrorPayloadForError(error)))
      })
    }
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "download" | "url"} action - Frontend action.
   * @returns {Promise<Record<string, ?> | null>} - Response payload.
   */
  async frontendModelCommandPayload(action) {
    await this.ensureFrontendModelClassInitialized()

    if (!(await this.runFrontendModelBeforeAction(action))) {
      return null
    }

    const resource = this.frontendModelResourceInstance()

    if (action === "index") {
      if (this.frontendModelCountRequested()) {
        if (!(await resource.supportsCount("index"))) {
          throw new Error("count is not supported when resource records are customized")
        }

        return {
          count: await resource.count(),
          status: "success"
        }
      }

      const pluck = this.frontendModelPluck()

      if (pluck.length > 0) {
        if (!(await resource.supportsPluck("index"))) {
          throw new Error("pluck is not supported when resource records are customized")
        }

        const values = await this.frontendModelPluckValues({
          pluck,
          query: this.frontendModelIndexQuery()
        })

        return {
          status: "success",
          values
        }
      }

      const models = await this.frontendModelRecords()
      await this.frontendModelComputeAbilities(models)
      const serializedModels = await Promise.all(models.map(async (model) => await resource.serialize(model, "index")))

      return {
        models: serializedModels,
        status: "success"
      }
    }

    const params = this.frontendModelParams()
    const modelClass = this.frontendModelClass()
    const id = params.id

    if (action === "create") {
      const mutationAttributes = frontendModelMutationAttributes(params)
      if (typeof mutationAttributes === "string") return this.frontendModelErrorPayload(mutationAttributes)

      const model = await this.frontendModelCreateRecord(mutationAttributes.attributes, mutationAttributes.nestedAttributes)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      const serializedModel = await resource.serialize(model, "create")

      return frontendModelSerializedModelSuccess(serializedModel)
    }

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      return this.frontendModelErrorPayload("Expected model id.")
    }

    if (action === "attach") {
      const attachmentName = params.attachmentName
      const attachmentInput = params.attachment

      if (typeof attachmentName !== "string" || attachmentName.length < 1) {
        return this.frontendModelErrorPayload("Expected attachmentName.")
      }

      if (typeof attachmentInput === "undefined") {
        return this.frontendModelErrorPayload("Expected attachment input.")
      }

      const model = await this.frontendModelFindRecord("attach", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      await model.getAttachmentByName(attachmentName).attach(attachmentInput)
      const serializedModel = await this.serializeFrontendModel(model)

      return frontendModelSerializedModelSuccess(serializedModel)
    }

    if (action === "download") {
      const attachmentParams = frontendModelAttachmentParams(params)
      if (typeof attachmentParams === "string") return this.frontendModelErrorPayload(attachmentParams)

      const model = await this.frontendModelFindRecord("download", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      const downloadedAttachment = await model.getAttachmentByName(attachmentParams.attachmentName).download(attachmentParams.attachmentId)

      if (!downloadedAttachment) {
        return this.frontendModelErrorPayload("Attachment not found.")
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
      }
    }

    if (action === "url") {
      const attachmentParams = frontendModelAttachmentParams(params)
      if (typeof attachmentParams === "string") return this.frontendModelErrorPayload(attachmentParams)

      const model = await this.frontendModelFindRecord("url", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      const url = await model.getAttachmentByName(attachmentParams.attachmentName).url(attachmentParams.attachmentId)

      if (!url) {
        return this.frontendModelErrorPayload("Attachment URL not available.")
      }

      return {
        status: "success",
        url
      }
    }

    if (action === "find") {
      const model = await this.frontendModelFindRecord("find", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      await this.frontendModelComputeAbilities([model])
      const serializedModel = await resource.serialize(model, "find")

      return frontendModelSerializedModelSuccess(serializedModel)
    }

    if (action === "update") {
      const mutationAttributes = frontendModelMutationAttributes(params)
      if (typeof mutationAttributes === "string") return this.frontendModelErrorPayload(mutationAttributes)

      const model = await this.frontendModelFindRecord("update", id)

      if (!model) {
        return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
      }

      const updatedModel = await resource.update(model, mutationAttributes.attributes, {nestedAttributes: mutationAttributes.nestedAttributes, controller: this})
      const serializedModel = await resource.serialize(updatedModel, "update")

      return frontendModelSerializedModelSuccess(serializedModel)
    }

    const model = await this.frontendModelFindRecord("destroy", id)

    if (!model) {
      return this.frontendModelErrorPayload(`${modelClass.name} not found.`)
    }

    await resource.destroy(model)

    return {status: "success"}
  }

  /** @returns {Promise<void>} - Shared frontend model API action with batch support. */
  async frontendApi() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    const params = /** @type {Record<string, ?>} */ (deserializeFrontendModelTransportValue(this.params()))
    const requests = Array.isArray(params.requests) ? params.requests : [params]
    /** @type {Array<Record<string, ?>>} */
    const responses = []

    for (const requestEntry of requests) {
      const commandType = requestEntry?.commandType
      const customPath = requestEntry?.customPath
      const model = requestEntry?.model
      const payload = requestEntry?.payload
      const requestId = requestEntry?.requestId

      if (typeof model !== "string" || model.length < 1) {
        responses.push({
          requestId,
          response: this.frontendModelErrorPayload("Expected request model.")
        })
        continue
      }

      const isBuiltInCommand = ["index", "find", "create", "update", "destroy", "attach", "download", "url"].includes(commandType)

      if (!isBuiltInCommand && (typeof customPath !== "string" || !customPath.startsWith("/"))) {
        responses.push({
          requestId,
          response: this.frontendModelErrorPayload("Expected request customPath.")
        })
        continue
      }

      try {
        let responsePayload

        if (isBuiltInCommand) {
          const commandParams = {
            ...(payload && typeof payload === "object" ? payload : {}),
            model
          }

          responsePayload = await this.withFrontendModelParams(commandParams, async () => {
            return await this.withFrontendModelRequestContext(commandParams, this.response(), async () => {
              return await this.frontendModelCommandPayload(commandType)
            })
          })
        } else {
          responsePayload = await this.frontendApiCustomCommandPayload({
            customPath,
            payload
          })
        }

        responses.push({
          requestId,
          response: responsePayload || this.frontendModelErrorPayload("Action halted by beforeAction.")
        })
      } catch (error) {
        await this.frontendModelLogEndpointError({
          action: "frontendApi",
          commandType,
          error,
          model,
          requestId
        })

        responses.push({
          requestId,
          response: this.frontendModelClientErrorPayloadForError(error)
        })
      }
    }

    await this.render({
      json: /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue({
        responses,
        status: "success"
      }))
    })
  }

  /**
   * Dispatches a custom frontend-model command through the shared frontend-model API endpoint.
   * @param {object} args - Arguments.
   * @param {string} args.customPath - Custom backend route path.
   * @param {?} args.payload - Request payload.
   * @returns {Promise<Record<string, ?>>} - Parsed JSON response payload.
   */
  async frontendApiCustomCommandPayload({customPath, payload}) {
    const configuration = this.getConfiguration()
    const response = new Response({configuration})
    const resolver = new RoutesResolver({
      configuration,
      request: this.getRequest(),
      response
    })
    resolver.params = {}
    const routeHookMatch = await resolver.resolveRouteResolverHooks(customPath)
    const configurationRoutes = configuration.getRoutes()
    const routeMatch = routeHookMatch || !configurationRoutes?.rootRoute ? undefined : resolver.matchPathWithRoutes(configurationRoutes.rootRoute, customPath)

    if (!routeHookMatch && !routeMatch) {
      throw new Error(`No custom frontend model route matched '${customPath}'`)
    }

    const actionParam = routeHookMatch?.action || resolver.params.action
    const controllerParam = routeHookMatch?.controller || resolver.params.controller
    const actionValue = typeof actionParam === "string" ? actionParam : (Array.isArray(actionParam) ? actionParam[0] : undefined)
    const controllerValue = typeof controllerParam === "string" ? controllerParam : (Array.isArray(controllerParam) ? controllerParam[0] : undefined)

    if (typeof actionValue !== "string" || actionValue.length < 1 || typeof controllerValue !== "string" || controllerValue.length < 1) {
      throw new Error(`Custom frontend model route matched '${customPath}' without controller/action params`)
    }

    const action = inflection.camelize(actionValue.replaceAll("-", "_").replaceAll("/", "_"), true)
    const controller = controllerValue
    const controllerPath = routeHookMatch?.controllerPath || `${configuration.getDirectory()}/src/routes/${controller}/controller.js`
    const viewPath = routeHookMatch?.viewPath || `${configuration.getDirectory()}/src/routes/${controller}`
    resolver.routeHookControllerClass = routeHookMatch?.controllerClass
    const controllerClass = await resolver.resolveControllerClass({controllerPath})
    const controllerParams = {
      ...((payload && typeof payload === "object") ? payload : {}),
      ...resolver.params
    }
    const controllerInstance = new controllerClass({
      action,
      configuration,
      controller,
      params: controllerParams,
      request: /** @type {import("./http-server/client/request.js").default} */ (this.getRequest()),
      response,
      viewPath
    })

    await this.withFrontendModelRequestContext(controllerParams, response, async () => {
      await controllerInstance._runBeforeCallbacks()
      const controllerMethods = /** @type {Record<string, () => Promise<void> | void>} */ (/** @type {?} */ (controllerInstance))

      await controllerMethods[action]()
    })

    const setCookieHeaders = response.headers["Set-Cookie"] || []

    for (const setCookieHeader of setCookieHeaders) {
      this.response().addHeader("Set-Cookie", setCookieHeader)
    }

    const responseBody = response.getBody()

    if (typeof responseBody !== "string" || responseBody.length < 1) {
      return {}
    }

    // Preserve nested transport markers so the outer shared frontend-model API
    // can return them unchanged and let the client hydrate once at the edge.
    return /** @type {Record<string, ?>} */ (JSON.parse(responseBody))
  }

  /** @returns {Promise<void>} - Collection action for frontend model resources. */
  async frontendIndex() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("index")
  }

  /** @returns {Promise<void>} - Member find action for frontend model resources. */
  async frontendFind() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("find")
  }

  /** @returns {Promise<void>} - Member update action for frontend model resources. */
  async frontendUpdate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("update")
  }

  /** @returns {Promise<void>} - Member attach action for frontend model resources. */
  async frontendAttach() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("attach")
  }

  /** @returns {Promise<void>} - Member download action for frontend model resources. */
  async frontendDownload() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("download")
  }

  /** @returns {Promise<void>} - Member URL action for frontend model resources. */
  async frontendUrl() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("url")
  }

  /** @returns {Promise<void>} - Member create action for frontend model resources. */
  async frontendCreate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("create")
  }

  /** @returns {Promise<void>} - Member destroy action for frontend model resources. */
  async frontendDestroy() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    await this.frontendModelRenderCommandResponse("destroy")
  }

  /** @returns {Promise<void>} - Custom collection/member command action for frontend-model resources. */
  async frontendCustomCommand() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    try {
      const responsePayload = await this.frontendModelCustomCommandPayload()

      await this.render({
        json: /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue(responsePayload))
      })
    } catch (error) {
      await this.frontendModelLogEndpointError({action: "frontendCustomCommand", commandType: "custom-command", error})

      await this.render({
        json: /** @type {Record<string, ?>} */ (serializeFrontendModelTransportValue(this.frontendModelClientErrorPayloadForError(error)))
      })
    }
  }

  /** @returns {Promise<Record<string, ?>>} - Response payload. */
  async frontendModelCustomCommandPayload() {
    const params = this.frontendModelParams()
    const methodName = params.frontendModelCustomCommandMethodName
    const scope = params.frontendModelCustomCommandScope

    if (typeof methodName !== "string" || methodName.length < 1) {
      return this.frontendModelErrorPayload("Expected frontend-model custom command method name.")
    }

    if (scope !== "collection" && scope !== "member") {
      return this.frontendModelErrorPayload("Expected frontend-model custom command scope.")
    }

    const resource = /** @type {Record<string, ?>} */ (this.frontendModelResourceInstance())
    const commandMethod = resource[methodName]

    if (typeof commandMethod !== "function") {
      return this.frontendModelErrorPayload(`Missing frontend-model custom command '${methodName}'.`)
    }

    const responsePayload = await commandMethod.call(resource)

    if (!responsePayload || typeof responsePayload !== "object") {
      return {status: "success"}
    }

    return /** @type {Record<string, ?>} */ (
      await this.autoSerializeFrontendModelsInPayload(
        responsePayload,
        /** @type {{serialize: (model: ?, action: string) => Promise<Record<string, ?>>}} */ (resource),
        methodName
      )
    )
  }

  /**
   * Walks a custom-command response payload and replaces any backend `Record`
   * instance with the resource's per-action serialized form so handlers can
   * return `{record, status: "ok"}` instead of explicitly calling
   * `await this.serialize(record, action)`. Plain objects, arrays, and
   * primitive values pass through and are later encoded by
   * `serializeFrontendModelTransportValue`.
   *
   * @param {?} value - Payload value.
   * @param {{serialize: (model: ?, action: string) => Promise<Record<string, ?>>}} resource - Resource instance providing `serialize`.
   * @param {string} action - Custom command method name passed to `resource.serialize` for per-action authorization filtering.
   * @param {WeakSet<object>} [seen] - Recursion stack of plain-object containers currently being walked. Membership is added on entry and removed on exit so a container shared between siblings (i.e. referenced twice but not cyclically) is walked on each reference instead of being short-circuited the second time, which would let backend `Record` instances inside it bypass `resource.serialize`.
   * @returns {Promise<?>} - Payload with backend `Record` instances replaced by serialized markers.
   */
  async autoSerializeFrontendModelsInPayload(value, resource, action, seen = new WeakSet()) {
    if (value === null || value === undefined) {
      return value
    }

    if (isBackendModelInstance(value)) {
      const richSerialized = await resource.serialize(value, action)
      const modelClass = /** @type {{constructor: {getModelName?: () => string, name?: string}}} */ (value).constructor
      const modelName = typeof modelClass.getModelName === "function" ? modelClass.getModelName() : (modelClass.name || "")

      // Wrap the resource-serialized payload in the frontend_model transport
      // marker. Marker-based decoding routes through `instantiateFromResponse`,
      // so abilities / queryData / associationCounts / preloadedRelationships
      // baked into the rich attributes by `resource.serialize` are restored on
      // the client without callers needing to wrap models manually.
      return {
        __velocious_type: "frontend_model",
        attributes: richSerialized,
        modelName
      }
    }

    if (Array.isArray(value)) {
      /** @type {Array<?>} */
      const result = []

      for (const entry of value) {
        result.push(await this.autoSerializeFrontendModelsInPayload(entry, resource, action, seen))
      }

      return result
    }

    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const container = /** @type {Record<string, ?>} */ (value)

      if (seen.has(container)) {
        // Cyclic back-reference along the current recursion path; the
        // ancestor frame is still walking this container and will produce
        // its serialized form. Returning the original container here
        // breaks the cycle without bypassing the walker for siblings that
        // share a non-cyclic reference (those re-enter the branch below
        // because the container is removed from `seen` on stack exit).
        return container
      }

      seen.add(container)

      try {
        /** @type {Record<string, ?>} */
        const result = {}

        for (const [key, nested] of Object.entries(container)) {
          // `assignSafeProperty` stores keys like `__proto__` as own
          // data properties instead of invoking the prototype setter,
          // so a custom-command response that echoes parsed client
          // input cannot pollute `Object.prototype` here. The transport
          // serializer applies the same protection on its own pass; we
          // just preserve it across the auto-serialize walk.
          assignSafeProperty(result, key, await this.autoSerializeFrontendModelsInPayload(nested, resource, action, seen))
        }

        return result
      } finally {
        seen.delete(container)
      }
    }

    return value
  }

}
