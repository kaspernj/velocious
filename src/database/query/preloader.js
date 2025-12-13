// @ts-check

import BelongsToPreloader from "./preloader/belongs-to.js"
import HasManyPreloader from "./preloader/has-many.js"
import HasOnePreloader from "./preloader/has-one.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloader {
  /**
   * @param {object} args
   * @param {typeof import("../record/index.js").default} args.modelClass
   * @param {import("../record/index.js").default[]} args.models
   * @param {Record<string, any>} args.preload
   */
  constructor({modelClass, models, preload, ...restArgs}) {
    restArgsError(restArgs)

    this.modelClass = modelClass
    this.models = models
    this.preload = preload
  }

  async run() {
    for (const preloadRelationshipName in this.preload) {
      const relationship = this.modelClass.getRelationshipByName(preloadRelationshipName)
      let targetModels

      if (relationship.getType() == "belongsTo") {
        const belongsToRelationship = /** @type {import("../record/relationships/belongs-to.js").default} */ (relationship)
        const hasManyPreloader = new BelongsToPreloader({models: this.models, relationship: belongsToRelationship})

        targetModels = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasMany") {
        const hasManyRelationship = /** @type {import("../record/relationships/has-many.js").default} */ (relationship)
        const hasManyPreloader = new HasManyPreloader({models: this.models, relationship: hasManyRelationship})

        targetModels = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasOne") {
        const hasOneRelationship = /** @type {import("../record/relationships/has-one.js").default} */ (relationship)
        const hasOnePreloader = new HasOnePreloader({models: this.models, relationship: hasOneRelationship})

        targetModels = await hasOnePreloader.run()
      } else {
        throw new Error(`Unknown relationship type: ${relationship.getType()}`)
      }

      // Handle any further preloads in the tree
      const newPreload = this.preload[preloadRelationshipName]

      if (typeof newPreload == "object" && targetModels.length > 0) {
        const targetModelClass = relationship.getTargetModelClass()

        if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

        const preloader = new VelociousDatabaseQueryPreloader({modelClass: targetModelClass, models: targetModels, preload: newPreload})

        await preloader.run()
      }
    }
  }
}
