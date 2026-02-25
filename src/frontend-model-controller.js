// @ts-check

import Controller from "./controller.js"
import * as inflection from "inflection"
import {deserializeFrontendModelTransportValue, serializeFrontendModelTransportValue} from "./frontend-models/transport-serialization.js"

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {import("./database/query/index.js").NestedPreloadRecord | string | string[] | boolean | undefined | null} preload - Preload shorthand.
 * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Normalized preload.
 */
function normalizeFrontendModelPreload(preload) {
  if (!preload) return null

  if (preload === true) return {}

  if (typeof preload === "string") {
    return {[preload]: true}
  }

  if (Array.isArray(preload)) {
    /** @type {import("./database/query/index.js").NestedPreloadRecord} */
    const normalized = {}

    for (const entry of preload) {
      if (typeof entry === "string") {
        normalized[entry] = true
        continue
      }

      if (isPlainObject(entry)) {
        const nested = normalizeFrontendModelPreload(entry)

        if (nested) {
          mergeNormalizedPreload(normalized, nested)
        }
        continue
      }

      throw new Error(`Invalid preload entry type: ${typeof entry}`)
    }

    return normalized
  }

  if (!isPlainObject(preload)) {
    throw new Error(`Invalid preload type: ${typeof preload}`)
  }

  /** @type {import("./database/query/index.js").NestedPreloadRecord} */
  const normalized = {}

  for (const [relationshipName, relationshipPreload] of Object.entries(preload)) {
    if (relationshipPreload === true || relationshipPreload === false) {
      normalized[relationshipName] = relationshipPreload
      continue
    }

    if (typeof relationshipPreload === "string" || Array.isArray(relationshipPreload) || isPlainObject(relationshipPreload)) {
      const nested = normalizeFrontendModelPreload(relationshipPreload)

      normalized[relationshipName] = nested || {}
      continue
    }

    throw new Error(`Invalid preload value for ${relationshipName}: ${typeof relationshipPreload}`)
  }

  return normalized
}

/**
 * @param {import("./database/query/index.js").NestedPreloadRecord} target - Target preload object.
 * @param {import("./database/query/index.js").NestedPreloadRecord} source - Source preload object.
 * @returns {void} - Mutates target with merged nested preload tree.
 */
function mergeNormalizedPreload(target, source) {
  for (const [relationshipName, relationshipPreload] of Object.entries(source)) {
    const existingValue = target[relationshipName]

    if (relationshipPreload === false) {
      target[relationshipName] = false
      continue
    }

    if (relationshipPreload === true) {
      if (existingValue === undefined) {
        target[relationshipName] = true
      }
      continue
    }

    if (!isPlainObject(relationshipPreload)) {
      throw new Error(`Invalid preload value for ${relationshipName}: ${typeof relationshipPreload}`)
    }

    if (isPlainObject(existingValue)) {
      mergeNormalizedPreload(
        /** @type {import("./database/query/index.js").NestedPreloadRecord} */ (existingValue),
        /** @type {import("./database/query/index.js").NestedPreloadRecord} */ (relationshipPreload)
      )
      continue
    }

    target[relationshipName] = relationshipPreload
  }
}

/**
 * @param {unknown} select - Select payload.
 * @returns {Record<string, string[]> | null} - Normalized model-name keyed select record.
 */
function normalizeFrontendModelSelect(select) {
  if (!select) return null

  if (!isPlainObject(select)) {
    throw new Error(`Invalid select type: ${typeof select}`)
  }

  /** @type {Record<string, string[]>} */
  const normalized = {}

  for (const [modelName, selectValue] of Object.entries(select)) {
    if (typeof selectValue === "string") {
      normalized[modelName] = [selectValue]
      continue
    }

    if (!Array.isArray(selectValue)) {
      throw new Error(`Invalid select value for ${modelName}: ${typeof selectValue}`)
    }

    for (const attributeName of selectValue) {
      if (typeof attributeName !== "string") {
        throw new Error(`Invalid select attribute for ${modelName}: ${typeof attributeName}`)
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
 * @property {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq"} operator - Search operator.
 * @property {any} value - Search value.
 */

/**
 * @param {unknown} searches - Search payload.
 * @returns {FrontendModelSearch[]} - Normalized searches.
 */
function normalizeFrontendModelSearches(searches) {
  if (!searches) return []

  if (!Array.isArray(searches)) {
    throw new Error(`Invalid searches type: ${typeof searches}`)
  }

  /** @type {FrontendModelSearch[]} */
  const normalized = []
  const supportedOperators = new Set(["eq", "notEq", "gt", "gteq", "lt", "lteq"])

  for (const search of searches) {
    if (!isPlainObject(search)) {
      throw new Error(`Invalid search entry type: ${typeof search}`)
    }

    const path = search.path
    const column = search.column
    const operator = search.operator

    if (!Array.isArray(path)) {
      throw new Error("Invalid search path: expected an array")
    }

    for (const pathEntry of path) {
      if (typeof pathEntry !== "string" || pathEntry.length < 1) {
        throw new Error("Invalid search path entry: expected non-empty string")
      }
    }

    if (typeof column !== "string" || column.length < 1) {
      throw new Error("Invalid search column: expected non-empty string")
    }

    if (typeof operator !== "string" || !supportedOperators.has(operator)) {
      throw new Error(`Invalid search operator: ${operator}`)
    }

    normalized.push({
      column,
      operator: /** @type {FrontendModelSearch["operator"]} */ (operator),
      path: [...path],
      value: search.value
    })
  }

  return normalized
}

/**
 * @param {unknown} where - Where payload.
 * @returns {Record<string, any> | null} - Normalized where hash.
 */
function normalizeFrontendModelWhere(where) {
  if (!where) return null

  if (!isPlainObject(where)) {
    throw new Error(`Invalid where type: ${typeof where}`)
  }

  return /** @type {Record<string, any>} */ (JSON.parse(JSON.stringify(where)))
}

/**
 * @param {string[]} path - Relationship path.
 * @returns {Record<string, any>} - Join object.
 */
function buildFrontendModelJoinObjectFromPath(path) {
  /** @type {Record<string, any>} */
  const joinObject = {}
  /** @type {Record<string, any>} */
  let currentNode = joinObject

  for (const relationshipName of path) {
    currentNode[relationshipName] = {}
    currentNode = currentNode[relationshipName]
  }

  return joinObject
}

/** Controller with built-in frontend model resource actions. */
export default class FrontendModelController extends Controller {
  /** @type {Record<string, any> | undefined} */
  _frontendModelParams = undefined

  /**
   * @returns {Record<string, any>} - Decoded request params.
   */
  frontendModelParams() {
    this._frontendModelParams ||= /** @type {Record<string, any>} */ (deserializeFrontendModelTransportValue(this.params()))

    return this._frontendModelParams
  }

  /**
   * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
   */
  frontendModelClass() {
    const frontendModelClass = this.frontendModelClassFromConfiguration()

    if (frontendModelClass) return frontendModelClass

    throw new Error(`No frontend model configured for controller '${this.frontendModelParams().controller}'. Configure backendProjects resources.`)
  }

  /**
   * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceConfiguration: import("./configuration-types.js").FrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
   */
  frontendModelResourceConfiguration() {
    const params = this.frontendModelParams()
    const controllerName = typeof params.controller === "string" ? params.controller : undefined

    if (!controllerName || controllerName.length < 1) return null

    const backendProjects = this.getConfiguration().getBackendProjects()

    for (const backendProject of backendProjects) {
      const resources = backendProject.frontendModels || backendProject.resources || {}

      for (const modelName in resources) {
        const resourceConfiguration = resources[modelName]
        const resourcePath = this.frontendModelResourcePath(modelName, resourceConfiguration)

        if (this.frontendModelResourceMatchesController({controllerName, resourcePath})) {
          return {backendProject, modelName, resourceConfiguration}
        }
      }
    }

    return null
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {{modelName: string, resourceConfiguration: import("./configuration-types.js").FrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model class.
   */
  frontendModelResourceConfigurationForModelClass(modelClass) {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    const resources = frontendModelResource.backendProject.frontendModels || frontendModelResource.backendProject.resources || {}
    const resourceConfiguration = resources[modelClass.name]

    if (!resourceConfiguration) return null

    return {
      modelName: modelClass.name,
      resourceConfiguration
    }
  }

  /**
   * @returns {typeof import("./database/record/index.js").default | null} - Frontend model class resolved from backend project configuration.
   */
  frontendModelClassFromConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    const modelClasses = this.getConfiguration().getModelClasses()
    const modelClass = modelClasses[frontendModelResource.modelName]

    if (!modelClass) {
      throw new Error(`Frontend model '${frontendModelResource.modelName}' is configured for '${this.frontendModelParams().controller}', but no model class was registered. Registered models: ${Object.keys(modelClasses).join(", ")}`)
    }

    return modelClass
  }

  /**
   * @param {string} modelName - Model class name.
   * @param {import("./configuration-types.js").FrontendModelResourceConfiguration} resourceConfiguration - Resource configuration.
   * @returns {string} - Normalized resource path.
   */
  frontendModelResourcePath(modelName, resourceConfiguration) {
    if (resourceConfiguration.path) return `/${resourceConfiguration.path.replace(/^\/+/, "")}`

    return `/${inflection.dasherize(inflection.pluralize(modelName))}`
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
   * @returns {import("./configuration-types.js").FrontendModelResourceServerConfiguration | null} - Optional server behavior config for frontend model actions.
   */
  frontendModelServerConfiguration() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) return null

    return frontendModelResource.resourceConfiguration.server || null
  }

  /**
   * @returns {string} - Frontend model primary key.
   */
  frontendModelPrimaryKey() {
    const frontendModelResource = this.frontendModelResourceConfiguration()

    if (!frontendModelResource) {
      throw new Error(`No frontend model resource configuration for controller '${this.frontendModelParams().controller}'`)
    }

    return frontendModelResource.resourceConfiguration.primaryKey || "id"
  }

  /**
   * @param {"index" | "find" | "create" | "update" | "destroy"} action - Frontend action.
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

    const abilityAction = abilities[action]

    if (typeof abilityAction !== "string" || abilityAction.length < 1) {
      throw new Error(`Resource '${frontendModelResource.modelName}' must define abilities.${action}`)
    }

    return abilityAction
  }

  /**
   * @param {"index" | "find" | "update" | "destroy"} action - Frontend action.
   * @returns {import("./database/query/model-class-query.js").default<any>} - Authorized query for the action.
   */
  frontendModelAuthorizedQuery(action) {
    const abilityAction = this.frontendModelAbilityAction(action)

    return this.frontendModelClass().accessibleFor(abilityAction)
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {string} - Primary key value as string.
   */
  frontendModelPrimaryKeyValue(model) {
    const value = model.attributes()[this.frontendModelPrimaryKey()]

    return String(value)
  }

  /**
   * @param {object} args - Arguments.
   * @param {"index" | "find" | "update" | "destroy"} args.action - Frontend action.
   * @param {import("./database/record/index.js").default[]} args.models - Candidate models.
   * @returns {Promise<import("./database/record/index.js").default[]>} - Authorized models.
   */
  async frontendModelFilterAuthorizedModels({action, models}) {
    if (models.length === 0) return models

    const primaryKey = this.frontendModelPrimaryKey()
    const ids = models.map((model) => this.frontendModelPrimaryKeyValue(model))
    const authorizedIdsRaw = await this.frontendModelAuthorizedQuery(action).where({[primaryKey]: ids}).pluck(primaryKey)
    const authorizedIds = new Set(authorizedIdsRaw.map((id) => String(id)))

    return models.filter((model) => authorizedIds.has(this.frontendModelPrimaryKeyValue(model)))
  }

  /**
   * @param {"index" | "find" | "update" | "destroy"} action - Frontend action.
   * @returns {Promise<boolean>} - Whether action should continue.
   */
  async runFrontendModelBeforeAction(action) {
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (!serverConfiguration?.beforeAction) return true

    const modelClass = this.frontendModelClass()
    const result = await serverConfiguration.beforeAction({
      action,
      controller: this,
      modelClass,
      params: this.frontendModelParams()
    })

    return result !== false
  }

  /**
   * @param {"find" | "update" | "destroy"} action - Frontend action.
   * @param {string | number} id - Record id.
   * @returns {Promise<import("./database/record/index.js").default | null>} - Located model record.
   */
  async frontendModelFindRecord(action, id) {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const primaryKey = this.frontendModelPrimaryKey()

    if (serverConfiguration?.find) {
      const model = await serverConfiguration.find({
        action,
        controller: this,
        id,
        modelClass,
        params: this.frontendModelParams()
      })

      if (!model) return null

      const authorizedModels = await this.frontendModelFilterAuthorizedModels({action, models: [model]})

      return authorizedModels[0] || null
    }

    let query = this.frontendModelAuthorizedQuery(action)
    const preload = action === "find" ? this.frontendModelPreload() : null

    if (preload) {
      query = query.preload(preload)
    }

    return await query.findBy({[primaryKey]: id})
  }

  /**
   * @returns {Promise<import("./database/record/index.js").default[]>} - Frontend model records.
   */
  async frontendModelRecords() {
    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()

    if (serverConfiguration?.records) {
      const models = await serverConfiguration.records({
        action: "index",
        controller: this,
        modelClass,
        params: this.frontendModelParams()
      })

      return await this.frontendModelFilterAuthorizedModels({action: "index", models})
    }

    let query = this.frontendModelAuthorizedQuery("index")
    const preload = this.frontendModelPreload()

    if (preload) {
      query = query.preload(preload)
    }

    const where = this.frontendModelWhere()

    if (where) {
      this.applyFrontendModelWhere({query, where})
    }

    const searches = this.frontendModelSearches()

    for (const search of searches) {
      this.applyFrontendModelSearch({query, search})
    }

    return await query.toArray()
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
    return normalizeFrontendModelSelect(this.frontendModelParams().select)
  }

  /**
   * @returns {FrontendModelSearch[]} - Frontend search filters.
   */
  frontendModelSearches() {
    return normalizeFrontendModelSearches(this.frontendModelParams().searches)
  }

  /**
   * @returns {Record<string, any> | null} - Frontend where filters.
   */
  frontendModelWhere() {
    return normalizeFrontendModelWhere(this.frontendModelParams().where)
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
    const columnName = targetModelClass.getAttributeNameToColumnNameMap()[search.column]

    if (!columnName) {
      throw new Error(`Unknown search column "${search.column}" for ${targetModelClass.name}`)
    }

    if (search.path.length > 0) {
      query.joins(buildFrontendModelJoinObjectFromPath(search.path))
    }

    const tableReference = query.getTableReferenceForJoin(...search.path)
    const columnSql = `${query.driver.quoteTable(tableReference)}.${query.driver.quoteColumn(columnName)}`
    const operatorMap = {
      eq: "=",
      gt: ">",
      gteq: ">=",
      lt: "<",
      lteq: "<=",
      notEq: "!="
    }
    const sqlOperator = operatorMap[search.operator]

    if (search.operator === "eq") {
      if (Array.isArray(search.value)) {
        if (search.value.length === 0) {
          query.where("1=0")
        } else {
          query.where(`${columnSql} IN (${search.value.map((entry) => query.driver.quote(entry)).join(", ")})`)
        }

        return
      }

      if (search.value === null) {
        query.where(`${columnSql} IS NULL`)
        return
      }
    }

    if (search.operator === "notEq") {
      if (Array.isArray(search.value)) {
        if (search.value.length === 0) {
          query.where("1=1")
        } else {
          query.where(`${columnSql} NOT IN (${search.value.map((entry) => query.driver.quote(entry)).join(", ")})`)
        }

        return
      }

      if (search.value === null) {
        query.where(`${columnSql} IS NOT NULL`)
        return
      }
    }

    query.where(`${columnSql} ${sqlOperator} ${query.driver.quote(search.value)}`)
  }

  /**
   * @param {object} args - Where args.
   * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
   * @param {Record<string, any>} args.where - Root-model where conditions.
   * @returns {void}
   */
  applyFrontendModelWhere({query, where}) {
    const modelClass = this.frontendModelClass()
    const attributeNameToColumnNameMap = modelClass.getAttributeNameToColumnNameMap()
    const rootTableReference = query.getTableReferenceForJoin()

    for (const [attributeName, value] of Object.entries(where)) {
      const columnName = attributeNameToColumnNameMap[attributeName]

      if (!columnName) {
        throw new Error(`Unknown where column "${attributeName}" for ${modelClass.name}`)
      }

      const columnSql = `${query.driver.quoteTable(rootTableReference)}.${query.driver.quoteColumn(columnName)}`

      if (Array.isArray(value)) {
        if (value.length === 0) {
          query.where("1=0")
        } else {
          query.where(`${columnSql} IN (${value.map((entry) => query.driver.quote(entry)).join(", ")})`)
        }

        continue
      }

      if (value == null) {
        query.where(`${columnSql} IS NULL`)
      } else {
        query.where(`${columnSql} = ${query.driver.quote(value)}`)
      }
    }
  }

  /**
   * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
   * @returns {string[] | null} - Selected attributes for model class.
   */
  frontendModelSelectedAttributesForModelClass(modelClass) {
    const select = this.frontendModelSelect()

    if (!select) return null

    return select[modelClass.name] || null
  }

  /**
   * @param {import("./database/record/index.js").default} model - Model instance.
   * @returns {Record<string, any>} - Serialized attributes filtered by select map.
   */
  serializeFrontendModelAttributes(model) {
    const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
    const selectedAttributes = this.frontendModelSelectedAttributesForModelClass(modelClass)
    const modelAttributes = model.attributes()

    if (!selectedAttributes) {
      return modelAttributes
    }

    /** @type {Record<string, any>} */
    const serializedAttributes = {}

    for (const attributeName of selectedAttributes) {
      if (attributeName in modelAttributes) {
        serializedAttributes[attributeName] = modelAttributes[attributeName]
      }
    }

    return serializedAttributes
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

      const primaryKey = relatedResource.resourceConfiguration.primaryKey || "id"
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
   * @param {unknown} value - Candidate preloaded value.
   * @returns {value is import("./database/record/index.js").default} - Whether value behaves like a model.
   */
  isSerializableFrontendModel(value) {
    return Boolean(value && typeof value === "object" && typeof /** @type {any} */ (value).attributes === "function")
  }

  /**
   * @param {import("./database/record/index.js").default[]} models - Models to serialize.
   * @returns {Promise<Record<string, any>[]>} - Serialized model payloads.
   */
  async serializeFrontendModels(models) {
    if (models.length < 1) return []

    /** @type {Array<Record<string, any>>} */
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

    return models.map((model, modelIndex) => {
      const serializedAttributes = this.serializeFrontendModelAttributes(model)
      const preloadedRelationships = preloadedRelationshipsPerModel[modelIndex]

      if (Object.keys(preloadedRelationships).length < 1) {
        return serializedAttributes
      }

      return {
        ...serializedAttributes,
        __preloadedRelationships: preloadedRelationships
      }
    })
  }

  /**
   * @param {import("./database/record/index.js").default} model - Frontend model record.
   * @returns {Promise<Record<string, any>>} - Serialized frontend model payload.
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
    const renderError = /** @type {((errorMessage: string) => Promise<void>) | undefined} */ (
      /** @type {any} */ (this).renderError
    )

    if (typeof renderError === "function") {
      await renderError.call(this, errorMessage)
      return
    }

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        errorMessage,
        status: "error"
      }))
    })
  }

  /** @returns {Promise<void>} - Collection action for frontend model resources. */
  async frontendIndex() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("index"))) return

    const models = await this.frontendModelRecords()

    const serverConfiguration = this.frontendModelServerConfiguration()
    const serializedModels = serverConfiguration?.serialize
      ? await Promise.all(models.map(async (model) => {
        return await serverConfiguration.serialize({
          action: "index",
          controller: this,
          model,
          modelClass: this.frontendModelClass(),
          params: this.frontendModelParams()
        })
      }))
      : await this.serializeFrontendModels(models)

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        models: serializedModels,
        status: "success"
      }))
    })
  }

  /** @returns {Promise<void>} - Member find action for frontend model resources. */
  async frontendFind() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("find"))) return

    const params = this.frontendModelParams()
    const id = params.id

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      await this.frontendModelRenderError("Expected model id.")
      return
    }

    const modelClass = this.frontendModelClass()
    const model = await this.frontendModelFindRecord("find", id)

    if (!model) {
      await this.frontendModelRenderError(`${modelClass.name} not found.`)
      return
    }

    const serverConfiguration = this.frontendModelServerConfiguration()
    const serializedModel = serverConfiguration?.serialize
      ? await serverConfiguration.serialize({
        action: "find",
        controller: this,
        model,
        modelClass,
        params
      })
      : await this.serializeFrontendModel(model)

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        model: serializedModel,
        status: "success"
      }))
    })
  }

  /** @returns {Promise<void>} - Member update action for frontend model resources. */
  async frontendUpdate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("update"))) return

    const params = this.frontendModelParams()
    const id = params.id
    const attributes = params.attributes

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      await this.frontendModelRenderError("Expected model id.")
      return
    }

    if (!attributes || typeof attributes !== "object") {
      await this.frontendModelRenderError("Expected model attributes.")
      return
    }

    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const model = await this.frontendModelFindRecord("update", id)

    if (!model) {
      await this.frontendModelRenderError(`${modelClass.name} not found.`)
      return
    }

    let updatedModel = model

    if (serverConfiguration?.update) {
      const callbackModel = await serverConfiguration.update({
        action: "update",
        attributes,
        controller: this,
        model,
        modelClass,
        params
      })

      if (callbackModel) updatedModel = callbackModel
    } else {
      model.assign(attributes)
      await model.save()
    }

    const serializedModel = serverConfiguration?.serialize
      ? await serverConfiguration.serialize({
        action: "update",
        controller: this,
        model: updatedModel,
        modelClass,
        params
      })
      : await this.serializeFrontendModel(updatedModel)

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        model: serializedModel,
        status: "success"
      }))
    })
  }

  /** @returns {Promise<void>} - Member destroy action for frontend model resources. */
  async frontendDestroy() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("destroy"))) return

    const params = this.frontendModelParams()
    const id = params.id

    if ((typeof id !== "string" && typeof id !== "number") || `${id}`.length < 1) {
      await this.frontendModelRenderError("Expected model id.")
      return
    }

    const modelClass = this.frontendModelClass()
    const serverConfiguration = this.frontendModelServerConfiguration()
    const model = await this.frontendModelFindRecord("destroy", id)

    if (!model) {
      await this.frontendModelRenderError(`${modelClass.name} not found.`)
      return
    }

    if (serverConfiguration?.destroy) {
      await serverConfiguration.destroy({
        action: "destroy",
        controller: this,
        model,
        modelClass,
        params
      })
    } else {
      await model.destroy()
    }

    await this.render({
      json: /** @type {Record<string, any>} */ (serializeFrontendModelTransportValue({
        status: "success"
      }))
    })
  }
}
