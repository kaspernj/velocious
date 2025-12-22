// @ts-check

import BaseInstanceRelationship from "./base.js"

/**
 * A generic query over some model type.
 * @template {typeof import("../index.js").default} MC
 * @template {typeof import("../index.js").default} TMC
 */
export default class VelociousDatabaseRecordHasManyInstanceRelationship extends BaseInstanceRelationship {
  /**
   * @param {import("./base.js").InstanceRelationshipsBaseArgs<MC, TMC>} args
   */
  constructor(args) {
    super(args)
  }

  /**
   * @param {Record<string, any>} data
   * @returns {InstanceType<TMC>}
   */
  build(data) {
    // Spawn new model of the targeted class
    const targetModelClass = this.getTargetModelClass()

    if (!targetModelClass) throw new Error("Can't build a new record without a taget model class")

    const newInstance = new targetModelClass(data)


    // Add it to the loaded models of this relationship
    if (this._loaded === undefined) {
      /** @type {import("../index.js").default[]} */
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


    // Return the new contructed model
    return newInstance
  }

  /** @returns {Promise<void>} */
  async load() {
    const foreignModels = await this.query().toArray()

    this.setLoaded(foreignModels)
    this.setDirty(false)
    this.setPreloaded(true)
  }

  /** @returns {import("../../query/model-class-query.js").default<TMC>} */
  query() {
    const foreignKey = this.getForeignKey()
    const primaryKey = this.getPrimaryKey()
    const primaryModelID = this.getModel().readColumn(primaryKey)
    const TargetModelClass = this.getTargetModelClass()

    if (!TargetModelClass) throw new Error("Cannot load without a target model class")

    /** @type {Record<string, any>} */
    const whereArgs = {}

    whereArgs[foreignKey] = primaryModelID

    const query = TargetModelClass.where(whereArgs)

    return query
  }

  /** @returns {Array<InstanceType<TMC>>} The loaded model or models (depending on relationship type) */
  loaded() {
    if (!this._preloaded && this.model.isPersisted()) {
      throw new Error(`${this.model.constructor.name}#${this.relationship.getRelationshipName()} hasn't been preloaded`)
    }

    if (this._loaded === undefined && this.model.isNewRecord()) {
      return []
    }

    return this._loaded
  }

  /**
   * @param {InstanceType<MC>[] | InstanceType<MC>} models
   * @returns {void}
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
   * @param {InstanceType<TMC>[]} models
   * @returns {void}
   */
  setLoaded(models) {
    if (!Array.isArray(models)) throw new Error(`Argument given to setLoaded wasn't an array: ${typeof models}`)

    this._loaded = models
  }
}
