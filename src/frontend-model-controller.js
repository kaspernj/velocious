// @ts-check

import Controller from "./controller.js"
import * as inflection from "inflection"

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

/** Controller with built-in frontend model resource actions. */
export default class FrontendModelController extends Controller {
  /**
   * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
   */
  frontendModelClass() {
    const frontendModelClass = this.frontendModelClassFromConfiguration()

    if (frontendModelClass) return frontendModelClass

    throw new Error(`No frontend model configured for controller '${this.params().controller}'. Configure backendProjects resources.`)
  }

  /**
   * @returns {{modelName: string, resourceConfiguration: import("./configuration-types.js").FrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
   */
  frontendModelResourceConfiguration() {
    const params = this.params()
    const controllerName = typeof params.controller === "string" ? params.controller : undefined

    if (!controllerName || controllerName.length < 1) return null

    const backendProjects = this.getConfiguration().getBackendProjects()

    for (const backendProject of backendProjects) {
      const resources = backendProject.frontendModels || backendProject.resources || {}

      for (const modelName in resources) {
        const resourceConfiguration = resources[modelName]
        const resourcePath = this.frontendModelResourcePath(modelName, resourceConfiguration)

        if (this.frontendModelResourceMatchesController({controllerName, resourcePath})) {
          return {modelName, resourceConfiguration}
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
    const backendProjects = this.getConfiguration().getBackendProjects()

    for (const backendProject of backendProjects) {
      const resources = backendProject.frontendModels || backendProject.resources || {}
      const resourceConfiguration = resources[modelClass.name]

      if (resourceConfiguration) {
        return {
          modelName: modelClass.name,
          resourceConfiguration
        }
      }
    }

    return null
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
      throw new Error(`Frontend model '${frontendModelResource.modelName}' is configured for '${this.params().controller}', but no model class was registered. Registered models: ${Object.keys(modelClasses).join(", ")}`)
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
      throw new Error(`No frontend model resource configuration for controller '${this.params().controller}'`)
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
      throw new Error(`No frontend model resource configuration for controller '${this.params().controller}'`)
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
      params: this.params()
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
        params: this.params()
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
        params: this.params()
      })

      return await this.frontendModelFilterAuthorizedModels({action: "index", models})
    }

    let query = this.frontendModelAuthorizedQuery("index")
    const preload = this.frontendModelPreload()

    if (preload) {
      query = query.preload(preload)
    }

    return await query.toArray()
  }

  /**
   * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Frontend preload data.
   */
  frontendModelPreload() {
    return normalizeFrontendModelPreload(this.params().preload)
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
   * @param {object} args - Arguments.
   * @param {import("./database/record/index.js").default} args.model - Frontend model record.
   * @param {boolean} args.relationshipIsCollection - Whether relation is has-many.
   * @returns {Promise<boolean>} - Whether nested model can be serialized.
   */
  async frontendModelCanSerializeRelatedModel({model, relationshipIsCollection}) {
    const serializableRelatedModels = await this.frontendModelFilterSerializableRelatedModels({
      models: [model],
      relationshipIsCollection
    })

    return serializableRelatedModels.length > 0
  }

  /**
   * @param {import("./database/record/index.js").default} model - Frontend model record.
   * @returns {Promise<Record<string, any>>} - Serialized preloaded relationships.
   */
  async serializeFrontendModelPreloadedRelationships(model) {
    const modelClass = /** @type {typeof import("./database/record/index.js").default} */ (model.constructor)
    const relationshipsMap = modelClass.getRelationshipsMap()
    /** @type {Record<string, any>} */
    const preloadedRelationships = {}

    for (const relationshipName in relationshipsMap) {
      const relationship = model.getRelationshipByName(relationshipName)

      if (!relationship.getPreloaded()) continue

      const loadedRelationship = relationship.loaded()

      if (Array.isArray(loadedRelationship)) {
        const serializableRelatedModels = await this.frontendModelFilterSerializableRelatedModels({
          models: loadedRelationship,
          relationshipIsCollection: true
        })

        preloadedRelationships[relationshipName] = await Promise.all(serializableRelatedModels.map(async (relatedModel) => {
          return await this.serializeFrontendModel(relatedModel)
        }))
      } else if (loadedRelationship && typeof loadedRelationship === "object" && typeof loadedRelationship.attributes === "function") {
        if (await this.frontendModelCanSerializeRelatedModel({model: loadedRelationship, relationshipIsCollection: false})) {
          preloadedRelationships[relationshipName] = await this.serializeFrontendModel(loadedRelationship)
        } else {
          preloadedRelationships[relationshipName] = null
        }
      } else {
        preloadedRelationships[relationshipName] = loadedRelationship == undefined ? null : loadedRelationship
      }
    }

    return preloadedRelationships
  }

  /**
   * @param {import("./database/record/index.js").default} model - Frontend model record.
   * @returns {Promise<Record<string, any>>} - Serialized frontend model payload.
   */
  async serializeFrontendModel(model) {
    const preloadedRelationships = await this.serializeFrontendModelPreloadedRelationships(model)

    if (Object.keys(preloadedRelationships).length < 1) {
      return model.attributes()
    }

    return {
      ...model.attributes(),
      __preloadedRelationships: preloadedRelationships
    }
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
      json: {
        errorMessage,
        status: "error"
      }
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

    await this.render({
      json: {
        models: await Promise.all(models.map(async (model) => {
          const serverConfiguration = this.frontendModelServerConfiguration()

          if (serverConfiguration?.serialize) {
            return await serverConfiguration.serialize({
              action: "index",
              controller: this,
              model,
              modelClass: this.frontendModelClass(),
              params: this.params()
            })
          }

          return await this.serializeFrontendModel(model)
        })),
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} - Member find action for frontend model resources. */
  async frontendFind() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("find"))) return

    const params = this.params()
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
      json: {
        model: serializedModel,
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} - Member update action for frontend model resources. */
  async frontendUpdate() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("update"))) return

    const params = this.params()
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
      json: {
        model: serializedModel,
        status: "success"
      }
    })
  }

  /** @returns {Promise<void>} - Member destroy action for frontend model resources. */
  async frontendDestroy() {
    if (this.request().httpMethod() === "OPTIONS") {
      await this.render({status: 204, json: {}})
      return
    }

    if (!(await this.runFrontendModelBeforeAction("destroy"))) return

    const params = this.params()
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
      json: {
        status: "success"
      }
    })
  }
}
