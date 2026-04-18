// @ts-check

import BaseInstanceRelationship from "./base.js"

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 * @augments {BaseInstanceRelationship<MC, TMC>}
 */
export default class VelociousDatabaseRecordHasManyInstanceRelationship extends BaseInstanceRelationship {
  /**
   * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args - Options object.
   */
  constructor(args) {
    super(args)
  }

  /**
   * @param {Record<string, any>} data - Data payload.
   * @returns {InstanceType<TMC>} - The build.
   */
  build(data) {
    // Spawn new model of the targeted class
    const targetModelClass = this.getTargetModelClass()

    if (!targetModelClass) throw new Error("Can't build a new record without a taget model class")

    const newInstance = /** @type {InstanceType<TMC>} */ (new targetModelClass(data))


    // Add it to the loaded models of this relationship
    if (this._loaded === undefined) {
      this._loaded = [newInstance]
    } else if (Array.isArray(this._loaded)) {
      this._loaded.push(newInstance)
    } else {
      throw new Error(`Loaded had an unexpected type: ${typeof this._loaded}`)
    }


    // Set loaded on the models inversed relationship
    const inverseOf = this.getRelationship().getInverseOf()

    if (inverseOf) {
      const inverseInstanceRelationship = newInstance.getRelationshipByName(inverseOf)

      inverseInstanceRelationship.setAutoSave(false)
      inverseInstanceRelationship.setLoaded(this.getModel())
    }


    // Assign the foreign key to the new model
    const parentModel = this.getModel()

    if (parentModel.isPersisted()) {
      const foreignKeyName = this.getForeignKey()
      const columnNameMap = targetModelClass.getColumnNameToAttributeNameMap()
      const foreignKeyAttributeName = columnNameMap[foreignKeyName]
      if (!foreignKeyAttributeName) throw new Error(`Unknown foreign key attribute name for ${foreignKeyName}`)
      const primaryKeyName = this.getPrimaryKey()
      const foreignKeyValue = parentModel.readColumn(primaryKeyName)
      /** @type {Record<string, any>} */
      const assignData = {}

      assignData[foreignKeyAttributeName] = foreignKeyValue

      newInstance.assign(assignData)
    }


    // Return the new contructed model
    return newInstance
  }

  /**
   * @param {Record<string, any>} data - Data payload.
   * @returns {Promise<InstanceType<TMC>>} - Resolves with the create.
   */
  async create(data) {
    const model = this.build(data)

    await model.save()

    return model
  }

  /** @returns {Promise<InstanceType<TMC>[]>} - Resolves with loaded models. */
  async load() {
    const foreignModels = /** @type {InstanceType<TMC>[]} */ (await this.query().load())

    this.setLoaded(foreignModels)
    this.setDirty(false)
    this.setPreloaded(true)

    return foreignModels
  }

  /** @returns {Promise<InstanceType<TMC>[]>} - Resolves with the array. */
  async toArray() {
    const loadedValue = await this.autoloadOrLoad()

    if (loadedValue === undefined) return []

    return Array.isArray(loadedValue) ? loadedValue : [loadedValue]
  }

  /**
   * @param {import("../../query/index.js").NestedPreloadRecord} preloads - Preload map for related records.
   * @returns {import("../../query/model-class-query.js").default<TMC>} - The preload.
   */
  preload(preloads) {
    return this.query().clone().preload(preloads)
  }

  /**
   * @param {string | number} modelID - Related model identifier.
   * @returns {Promise<InstanceType<TMC>>} - Resolves with the find.
   */
  async find(modelID) {
    return /** @type {Promise<InstanceType<TMC>>} */ (this.query().find(modelID))
  }

  /** @returns {import("../../query/model-class-query.js").default<TMC>} - The query.  */
  query() {
    if (!this.getModel().isPersisted()) throw new Error("Cannot build a query for an unpersisted parent model")

    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Cannot load without a target model class")

    const throughRelationshipName = this.getRelationship().through

    if (throughRelationshipName) {
      const parentModelClass = this.getModel().getModelClass()
      const throughRelationship = parentModelClass.getRelationshipByName(throughRelationshipName)
      const throughModelClass = throughRelationship.getTargetModelClass()

      if (!throughModelClass) throw new Error(`Through relationship ${throughRelationshipName} has no target model class`)

      const throughForeignKey = throughRelationship.getForeignKey()
      const throughPrimaryKey = throughRelationship.getPrimaryKey()
      const targetForeignKey = this.getForeignKey()
      const targetTable = TargetModelClass.tableName()
      const throughTable = throughModelClass.tableName()
      const driver = TargetModelClass.connection()
      const parentPrimaryKey = this.getPrimaryKey()
      const parentId = /** @type {string | number} */ (this.getModel().readColumn(parentPrimaryKey))
      const joinSql = `LEFT JOIN ${driver.quoteTable(throughTable)} ON ${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughPrimaryKey)} = ${driver.quoteTable(targetTable)}.${driver.quoteColumn(targetForeignKey)}`
      const whereSql = `${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughForeignKey)} = ${driver.options().quote(parentId)}`

      const query = TargetModelClass.joins(joinSql).where(whereSql)

      return this.applyScope(query)
    }

    const foreignKey = this.getForeignKey()
    const primaryKey = this.getPrimaryKey()
    const primaryModelID = /** @type {string | number} */ (this.getModel().readColumn(primaryKey))

    /** @type {Record<string, string | number>} */
    const whereArgs = {}

    whereArgs[foreignKey] = primaryModelID

    const query = TargetModelClass.where(whereArgs)

    return this.applyScope(query)
  }

  /** @returns {Array<InstanceType<TMC>>} The loaded model or models (depending on relationship type) */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    if (this._loaded === undefined && this.model.isNewRecord()) {
      return []
    }

    return Array.isArray(this._loaded) ? this._loaded : []
  }

  /**
   * @param {InstanceType<TMC>[] | InstanceType<TMC>} models - Model instances.
   * @returns {void} - No return value.
   */
  addToLoaded(models) {
    if (!models) {
      throw new Error("Need to give something")
    } else if (Array.isArray(models)) {
      for (const model of models) {
        if (this._loaded === undefined) {
          this._loaded = [model]
        } else if (Array.isArray(this._loaded)) {
          this._loaded.push(model)
        } else {
          throw new Error(`Unexpected loaded type: ${typeof this._loaded}`)
        }
      }
    } else {
      if (this._loaded === undefined) {
        this._loaded = [models]
      } else if (Array.isArray(this._loaded)) {
        this._loaded.push(models)
      } else {
        throw new Error(`Unexpected loaded type: ${typeof this._loaded}`)
      }
    }
  }

  /**
   * @param {InstanceType<TMC>[]} models - Model instances.
   * @returns {void} - No return value.
   */
  setLoaded(models) {
    if (!Array.isArray(models)) throw new Error(`Argument given to setLoaded wasn't an array: ${typeof models}`)

    this._loaded = models
  }
}
