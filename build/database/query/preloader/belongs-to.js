// @ts-check

import ensureModelClassInitialized from "./ensure-model-class-initialized.js"
import PreloaderSelection from "./selection.js"
import preloadQueryForModel, { bindPreloadModelClass } from "./query-for-model.js"
import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderBelongsTo {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../record/index.js").default[]} args.models - Model instances.
   * @param {import("../../record/relationships/belongs-to.js").default} args.relationship - Relationship.
   * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
   */
  constructor({models, relationship, selection, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
    this.selection = selection || new PreloaderSelection()
  }

  async run() {
    const sourceModelClass = this.models[0].getModelClass()
    const foreignKey = this.relationship.getForeignKeyForModelClasses({modelClass: sourceModelClass, targetModelClass: sourceModelClass})
    const primaryKey = this.relationship.getPrimaryKey()
    const relationshipName = this.relationship.getRelationshipName()

    if (this.relationship.getPolymorphic()) {
      return await this._runPolymorphic({foreignKey, primaryKey, relationshipName})
    }

    const rawTargetModelClass = this.relationship.getTargetModelClass()

    if (!rawTargetModelClass) throw new Error("No target model class could be gotten from relationship")

    const targetModelClass = bindPreloadModelClass(this.models, rawTargetModelClass)

    /**
     * Satisfied targets.
     * @type {import("../../record/index.js").default[]} */
    const satisfiedTargets = []
    /**
     * Models to load.
     * @type {import("../../record/index.js").default[]} */
    const modelsToLoad = []

    for (const model of this.models) {
      const instanceRelationship = model.getRelationshipByName(relationshipName)

      if (this.selection.isSatisfied({instanceRelationship, targetModelClass, mappingColumns: [primaryKey]})) {
        const loaded = /** @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined())

        if (loaded) satisfiedTargets.push(loaded)
      } else {
        modelsToLoad.push(model)
      }
    }

    if (modelsToLoad.length == 0) return satisfiedTargets

    /**
     * Foreign key values.
     * @type {Set<number | string>} */
    const foreignKeyValues = new Set()

    for (const model of modelsToLoad) {
      const foreignKeyValue = /** @type {string | number | null | undefined} */ (model.readColumn(foreignKey))

      // Skip null/undefined foreign keys: a belongsTo with no foreign key has no
      // target, and including them would serialize to e.g. `IN (null)` which
      // throws on non-string primary-key columns.
      if (foreignKeyValue === null || foreignKeyValue === undefined) continue

      foreignKeyValues.add(foreignKeyValue)
    }

    /**
     * Target models by id.
     * @type {Record<string, import("../../record/index.js").default>} */
    const targetModelsById = {}

    /**
     * Target models.
     * @type {import("../../record/index.js").default[]} */
    let targetModels = []

    // Only query when at least one model has a non-null foreign key.
    if (foreignKeyValues.size > 0) {
      await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration(), modelsToLoad[0])

      // Build the query once with scope and selection, then clone it per cohort so
      // the IN-list size stays within driver limits without rebuilding shared state.
      let baseQuery = preloadQueryForModel(modelsToLoad, targetModelClass)

      baseQuery = this.relationship.applyScope(baseQuery)
      baseQuery = this.selection.applyToQuery({query: baseQuery, targetModelClass, mappingColumns: [primaryKey]})

      const driver = baseQuery.driver
      const cohorts = driver.chunkValues([...foreignKeyValues], (chunk) => baseQuery.clone().where({[primaryKey]: chunk}).toSql())

      for (const cohort of cohorts) {
        const cohortQuery = baseQuery.clone().where({[primaryKey]: cohort})
        const foundTargetModels = await cohortQuery.toArray()

        targetModels.push(...foundTargetModels)

        for (const targetModel of foundTargetModels) {
          const primaryKeyValue = /** @type {string | number} */ (targetModel.readColumn(primaryKey))

          targetModelsById[primaryKeyValue] = targetModel
        }
      }
    }

    // Set the target preloaded models on the given models
    for (const model of modelsToLoad) {
      const foreignKeyValue = /** @type {string | number} */ (model.readColumn(foreignKey))
      const targetModel = targetModelsById[foreignKeyValue]
      const modelRelationship = model.getRelationshipByName(relationshipName)

      modelRelationship.setPreloaded(true)
      modelRelationship.setLoaded(targetModel)
    }

    return [...satisfiedTargets, ...targetModels]
  }

  /**
   * Preload a polymorphic belongsTo, grouping models by their target type so
   * each concrete target model class is queried separately.
   * @param {object} args - Options object.
   * @param {string} args.foreignKey - Foreign key column.
   * @param {string} args.primaryKey - Primary key column on the target.
   * @param {string} args.relationshipName - Relationship name.
   * @returns {Promise<{targetModels: import("../../record/index.js").default[], targetModelsByClassName: Record<string, import("../../record/index.js").default[]>}>} - Loaded targets and a per-class-name grouping.
   */
  async _runPolymorphic({foreignKey, primaryKey, relationshipName}) {
    const typeColumn = this.relationship.getPolymorphicTypeColumn()
    const configuration = this.relationship.getConfiguration()

    /**
     * Model meta.
     * @type {{foreignKeyValue: number | string | undefined, model: import("../../record/index.js").default, targetType: string | undefined}[]} */
    const modelMeta = []

    /**
     * Satisfied targets.
     * @type {import("../../record/index.js").default[]} */
    const satisfiedTargets = []

    /**
     * Target models by class name.
     * @type {Record<string, import("../../record/index.js").default[]>} */
    const targetModelsByClassName = {}

    for (const model of this.models) {
      const targetType = /** @type {string | undefined} */ (model.readColumn(typeColumn))
      const instanceRelationship = model.getRelationshipByName(relationshipName)
      const targetModelClass = targetType ? bindPreloadModelClass(this.models, configuration.getModelClass(targetType)) : undefined

      if (targetModelClass && this.selection.isSatisfied({instanceRelationship, targetModelClass, mappingColumns: [primaryKey]})) {
        const loaded = /** @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined())

        if (loaded) {
          satisfiedTargets.push(loaded)

          const className = /** @type {typeof import("../../record/index.js").default} */ (loaded.constructor).getModelName()

          if (!targetModelsByClassName[className]) targetModelsByClassName[className] = []
          targetModelsByClassName[className].push(loaded)
        }

        continue
      }

      modelMeta.push({
        foreignKeyValue: /** @type {string | number | undefined} */ (model.readColumn(foreignKey)),
        model,
        targetType
      })
    }

    /**
     * Foreign key values by type.
     * @type {Record<string, Set<number | string>>} */
    const foreignKeyValuesByType = {}

    for (const meta of modelMeta) {
      if (meta.targetType === undefined || meta.targetType === null) continue
      if (meta.foreignKeyValue === undefined || meta.foreignKeyValue === null) continue

      if (!foreignKeyValuesByType[meta.targetType]) foreignKeyValuesByType[meta.targetType] = new Set()
      foreignKeyValuesByType[meta.targetType].add(meta.foreignKeyValue)
    }

    /**
     * Target models by type and id.
     * @type {Record<string, Record<number | string, import("../../record/index.js").default>>} */
    const targetModelsByTypeAndId = {}

    /**
     * Target models.
     * @type {import("../../record/index.js").default[]} */
    const targetModels = []

    for (const targetType in foreignKeyValuesByType) {
      const targetModelClass = bindPreloadModelClass(this.models, configuration.getModelClass(targetType))

      await ensureModelClassInitialized(targetModelClass, configuration, this.models[0])

      let baseQuery = preloadQueryForModel(this.models, targetModelClass)

      baseQuery = this.relationship.applyScope(baseQuery)
      baseQuery = this.selection.applyToQuery({query: baseQuery, targetModelClass, mappingColumns: [primaryKey]})

      const driver = baseQuery.driver
      const cohorts = driver.chunkValues([...foreignKeyValuesByType[targetType]], (chunk) => baseQuery.clone().where({[primaryKey]: chunk}).toSql())

      targetModelsByTypeAndId[targetType] = {}

      for (const cohort of cohorts) {
        const cohortQuery = baseQuery.clone().where({[primaryKey]: cohort})
        const foundTargetModels = await cohortQuery.toArray()

        targetModels.push(...foundTargetModels)

        const className = targetModelClass.getModelName()

        if (!targetModelsByClassName[className]) targetModelsByClassName[className] = []
        targetModelsByClassName[className].push(...foundTargetModels)

        for (const targetModel of foundTargetModels) {
          const primaryKeyValue = /** @type {string | number} */ (targetModel.readColumn(primaryKey))

          targetModelsByTypeAndId[targetType][primaryKeyValue] = targetModel
        }
      }
    }

    for (const meta of modelMeta) {
      const modelRelationship = meta.model.getRelationshipByName(relationshipName)
      const targetModel = (meta.targetType && meta.foreignKeyValue !== undefined && meta.foreignKeyValue !== null)
        ? targetModelsByTypeAndId[meta.targetType]?.[meta.foreignKeyValue]
        : undefined

      modelRelationship.setPreloaded(true)
      modelRelationship.setLoaded(targetModel)
    }

    return {targetModels: [...satisfiedTargets, ...targetModels], targetModelsByClassName}
  }
}
