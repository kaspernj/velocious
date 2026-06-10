// @ts-check

import ensureModelClassInitialized from "./ensure-model-class-initialized.js"
import PreloaderSelection from "./selection.js"
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
    const foreignKey = this.relationship.getForeignKey()
    const primaryKey = this.relationship.getPrimaryKey()
    const relationshipName = this.relationship.getRelationshipName()

    if (this.relationship.getPolymorphic()) {
      return await this._runPolymorphic({foreignKey, primaryKey, relationshipName})
    }

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

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
        const loaded = /**
 * Documents this API.
 * @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined())

        if (loaded) satisfiedTargets.push(loaded)
      } else {
        modelsToLoad.push(model)
      }
    }

    if (modelsToLoad.length == 0) return satisfiedTargets

    /**
 * Foreign key values.
 * @type {Array<number | string>} */
    const foreignKeyValues = []

    for (const model of modelsToLoad) {
      const foreignKeyValue = /**
 * Documents this API.
 * @type {string | number | null | undefined} */ (model.readColumn(foreignKey))

      // Skip null/undefined foreign keys: a belongsTo with no foreign key has no
      // target, and including them would serialize to e.g. `IN (null)` which
      // throws on non-string primary-key columns.
      if (foreignKeyValue === null || foreignKeyValue === undefined) continue

      if (!foreignKeyValues.includes(foreignKeyValue)) foreignKeyValues.push(foreignKeyValue)
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
    if (foreignKeyValues.length > 0) {
      await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration())

      /**
 * Where args.
 * @type {Record<string, string | number | Array<string | number>>} */
      const whereArgs = {}

      whereArgs[primaryKey] = foreignKeyValues

      // Load target models to be preloaded on the given models
      let query = targetModelClass.where(whereArgs)

      query = this.relationship.applyScope(query)
      query = this.selection.applyToQuery({query, targetModelClass, mappingColumns: [primaryKey]})

      targetModels = await query.toArray()

      for (const targetModel of targetModels) {
        const primaryKeyValue = /**
 * Documents this API.
 * @type {string | number} */ (targetModel.readColumn(primaryKey))

        targetModelsById[primaryKeyValue] = targetModel
      }
    }

    // Set the target preloaded models on the given models
    for (const model of modelsToLoad) {
      const foreignKeyValue = /**
 * Documents this API.
 * @type {string | number} */ (model.readColumn(foreignKey))
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
      const targetType = /**
 * Documents this API.
 * @type {string | undefined} */ (model.readColumn(typeColumn))
      const instanceRelationship = model.getRelationshipByName(relationshipName)
      const targetModelClass = targetType ? configuration.getModelClass(targetType) : undefined

      if (targetModelClass && this.selection.isSatisfied({instanceRelationship, targetModelClass, mappingColumns: [primaryKey]})) {
        const loaded = /**
 * Documents this API.
 * @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined())

        if (loaded) {
          satisfiedTargets.push(loaded)

          const className = /**
 * Documents this API.
 * @type {typeof import("../../record/index.js").default} */ (loaded.constructor).getModelName()

          if (!targetModelsByClassName[className]) targetModelsByClassName[className] = []
          targetModelsByClassName[className].push(loaded)
        }

        continue
      }

      modelMeta.push({
        foreignKeyValue: /**
 * Documents this API.
 * @type {string | number | undefined} */ (model.readColumn(foreignKey)),
        model,
        targetType
      })
    }

    /**
 * Foreign key values by type.
 * @type {Record<string, Array<number | string>>} */
    const foreignKeyValuesByType = {}

    for (const meta of modelMeta) {
      if (meta.targetType === undefined || meta.targetType === null) continue
      if (meta.foreignKeyValue === undefined || meta.foreignKeyValue === null) continue

      if (!foreignKeyValuesByType[meta.targetType]) foreignKeyValuesByType[meta.targetType] = []
      if (!foreignKeyValuesByType[meta.targetType].includes(meta.foreignKeyValue)) foreignKeyValuesByType[meta.targetType].push(meta.foreignKeyValue)
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
      const targetModelClass = configuration.getModelClass(targetType)

      await ensureModelClassInitialized(targetModelClass, configuration)

      /**
 * Where args.
 * @type {Record<string, string | number | Array<string | number>>} */
      const whereArgs = {}

      whereArgs[primaryKey] = foreignKeyValuesByType[targetType]

      let query = targetModelClass.where(whereArgs)

      query = this.relationship.applyScope(query)
      query = this.selection.applyToQuery({query, targetModelClass, mappingColumns: [primaryKey]})

      const foundTargetModels = await query.toArray()

      targetModels.push(...foundTargetModels)

      const className = targetModelClass.getModelName()

      if (!targetModelsByClassName[className]) targetModelsByClassName[className] = []
      targetModelsByClassName[className].push(...foundTargetModels)

      targetModelsByTypeAndId[targetType] = {}

      for (const targetModel of foundTargetModels) {
        const primaryKeyValue = /**
 * Documents this API.
 * @type {string | number} */ (targetModel.readColumn(primaryKey))

        targetModelsByTypeAndId[targetType][primaryKeyValue] = targetModel
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
