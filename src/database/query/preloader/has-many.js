// @ts-check

import ensureModelClassInitialized from "./ensure-model-class-initialized.js"
import PreloaderSelection from "./selection.js"
import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasMany {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../record/index.js").default[]} args.models - Model instances.
   * @param {import("../../record/relationships/has-many.js").default} args.relationship - Relationship.
   * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
   */
  constructor({models, relationship, selection, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
    this.selection = selection || new PreloaderSelection()
  }

  /**
   * Runs run.
   * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
   */
  async run() {
    if (this.relationship.through) {
      return await this._runThrough()
    }

    return await this._runDirect()
  }

  /**
   * Partitions `this.models` into those already satisfied by the current
   * selection (skip) and those that still need loading. Satisfied models'
   * already-loaded targets are collected so nested preloads keep working.
   * @param {typeof import("../../record/index.js").default} targetModelClass - Target model class.
   * @param {string[]} mappingColumns - Columns required for mapping (foreign key).
   * @returns {{modelsToLoad: import("../../record/index.js").default[], satisfiedTargets: import("../../record/index.js").default[]}} - The partition.
   */
  _partition(targetModelClass, mappingColumns) {
    const relationshipName = this.relationship.getRelationshipName()
    /**
     * Models to load.
      @type {import("../../record/index.js").default[]} */
    const modelsToLoad = []
    /**
     * Satisfied targets.
      @type {import("../../record/index.js").default[]} */
    const satisfiedTargets = []

    for (const model of this.models) {
      const instanceRelationship = model.getRelationshipByName(relationshipName)

      if (this.selection.isSatisfied({instanceRelationship, targetModelClass, mappingColumns})) {
        const loaded = instanceRelationship.getLoadedOrUndefined()

        if (Array.isArray(loaded)) satisfiedTargets.push(...loaded)
      } else {
        modelsToLoad.push(model)
      }
    }

    return {modelsToLoad, satisfiedTargets}
  }

  /**
   * Preload through a join table (e.g. hasMany("invoiceGroups", {through: "invoiceGroupLinks"})).
   * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
   */
  async _runThrough() {
    const primaryKey = this.relationship.getPrimaryKey()

    if (!primaryKey) {
      throw new Error(`${this.relationship.getModelClass().name}#${this.relationship.getRelationshipName()} doesn't have a primary key`)
    }

    const throughRelationshipName = /**
                                     * Narrows the runtime value to the documented type.
                                      @type {string} */ (this.relationship.through)
    const parentModelClass = this.relationship.getModelClass()
    const throughRelationship = parentModelClass.getRelationshipByName(throughRelationshipName)
    const throughModelClass = throughRelationship.getTargetModelClass()

    if (!throughModelClass) throw new Error(`Through relationship ${throughRelationshipName} has no target model class`)

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    const targetForeignKey = this.relationship.getForeignKey()
    const {modelsToLoad, satisfiedTargets} = this._partition(targetModelClass, [targetForeignKey])

    if (modelsToLoad.length == 0) return satisfiedTargets

    const configuration = this.relationship.getConfiguration()

    await ensureModelClassInitialized(throughModelClass, configuration)
    await ensureModelClassInitialized(targetModelClass, configuration)

    const throughForeignKey = throughRelationship.getForeignKey()

    /**
     * Models primary key values.
      @type {Array<number | string>} */
    const modelsPrimaryKeyValues = []

    /**
     * Models by primary key value.
      @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const modelsByPrimaryKeyValue = {}

    /**
     * Preload collections.
      @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const preloadCollections = {}

    for (const model of modelsToLoad) {
      const primaryKeyValue = /**
                               * Narrows the runtime value to the documented type.
                                @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = []

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    // Step 1: Query the through table to build parent→target ID mapping
    const throughModels = await throughModelClass
      .where({[throughForeignKey]: modelsPrimaryKeyValues})
      .toArray()

    /**
     * Parent to target ids.
      @type {Record<string | number, Array<string | number>>} */
    const parentToTargetIds = {}

    /**
     * All target ids.
      @type {Set<string | number>} */
    const allTargetIds = new Set()

    for (const throughModel of throughModels) {
      const parentId = /**
                        * Narrows the runtime value to the documented type.
                         @type {string | number} */ (throughModel.readColumn(throughForeignKey))
      const throughId = /**
                         * Narrows the runtime value to the documented type.
                          @type {string | number} */ (throughModel.readColumn(throughModelClass.primaryKey()))

      if (!(parentId in parentToTargetIds)) parentToTargetIds[parentId] = []

      parentToTargetIds[parentId].push(throughId)
      allTargetIds.add(throughId)
    }

    // Step 2: Load target models by the foreign key that points to the through table
    /**
     * Target models.
      @type {import("../../record/index.js").default[]} */
    let targetModels = []

    if (allTargetIds.size > 0) {
      let query = targetModelClass.where({[targetForeignKey]: [...allTargetIds]})

      query = this.relationship.applyScope(query)
      query = this.selection.applyToQuery({query, targetModelClass, mappingColumns: [targetForeignKey]})
      targetModels = await query.toArray()
    }

    // Step 3: Index target models by their foreign key (maps to through model ID)
    /**
     * Target models by foreign key.
      @type {Record<string | number, Array<import("../../record/index.js").default>>} */
    const targetModelsByForeignKey = {}

    for (const targetModel of targetModels) {
      const fkValue = /**
                       * Narrows the runtime value to the documented type.
                        @type {string | number} */ (targetModel.readColumn(targetForeignKey))

      if (!(fkValue in targetModelsByForeignKey)) targetModelsByForeignKey[fkValue] = []

      targetModelsByForeignKey[fkValue].push(targetModel)
    }

    // Step 4: Map targets to parents via the through mapping
    for (const parentId in parentToTargetIds) {
      const throughIds = parentToTargetIds[parentId]

      for (const throughId of throughIds) {
        const matchingTargets = targetModelsByForeignKey[throughId] || []

        for (const targetModel of matchingTargets) {
          if (parentId in preloadCollections) {
            preloadCollections[parentId].push(targetModel)
          }
        }
      }
    }

    for (const modelValue in preloadCollections) {
      const preloadedCollection = preloadCollections[modelValue]

      for (const model of modelsByPrimaryKeyValue[modelValue]) {
        const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

        // Replace rather than append: `modelsToLoad` are exactly the records we
        // intend to (re)load, so a forced re-preload must not duplicate entries.
        modelRelationship.setLoaded(preloadedCollection)
        modelRelationship.setPreloaded(true)
      }
    }

    return [...satisfiedTargets, ...targetModels]
  }

  /**
   * Preload direct has-many relationships.
   * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
   */
  async _runDirect() {
    const foreignKey = this.relationship.getForeignKey()
    const primaryKey = this.relationship.getPrimaryKey()

    if (!primaryKey) {
      throw new Error(`${this.relationship.getModelClass().name}#${this.relationship.getRelationshipName()} doesn't have a primary key`)
    }

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    const {modelsToLoad, satisfiedTargets} = this._partition(targetModelClass, [foreignKey])

    if (modelsToLoad.length == 0) return satisfiedTargets

    /**
     * Models primary key values.
      @type {Array<number | string>} */
    const modelsPrimaryKeyValues = []

    /**
     * Models by primary key value.
      @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const modelsByPrimaryKeyValue = {}

    /**
     * Preload collections.
      @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const preloadCollections = {}

    for (const model of modelsToLoad) {
      const primaryKeyValue = /**
                               * Narrows the runtime value to the documented type.
                                @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = []

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    /**
     * Where args.
      @type {Record<string, string | number | Array<string | number>>} */
    const whereArgs = {}

    whereArgs[foreignKey] = modelsPrimaryKeyValues

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()

      whereArgs[typeColumn] = this.relationship.getModelClass().getModelName()
    }

    await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration())

    let query = targetModelClass.where(whereArgs)

    query = this.relationship.applyScope(query)
    query = this.selection.applyToQuery({query, targetModelClass, mappingColumns: [foreignKey]})

    const targetModels = await query.toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = /**
                               * Narrows the runtime value to the documented type.
                                @type {string | number} */ (targetModel.readColumn(foreignKey))

      preloadCollections[foreignKeyValue].push(targetModel)
    }

    for (const modelValue in preloadCollections) {
      const preloadedCollection = preloadCollections[modelValue]

      for (const model of modelsByPrimaryKeyValue[modelValue]) {
        const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

        // Replace rather than append: `modelsToLoad` are exactly the records we
        // intend to (re)load, so a forced re-preload must not duplicate entries.
        modelRelationship.setLoaded(preloadedCollection)
        modelRelationship.setPreloaded(true)
      }
    }

    return [...satisfiedTargets, ...targetModels]
  }
}
