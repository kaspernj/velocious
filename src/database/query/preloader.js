// @ts-check

import BelongsToPreloader from "./preloader/belongs-to.js"
import HasManyPreloader from "./preloader/has-many.js"
import HasOnePreloader from "./preloader/has-one.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloader {
  /**
   * @param {object} args - Options object.
   * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
   * @param {import("../record/index.js").default[]} args.models - Model instances.
   * @param {Record<string, any>} args.preload - Preload.
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
      let preloadResult

      if (relationship.getType() == "belongsTo") {
        const belongsToRelationship = /** @type {import("../record/relationships/belongs-to.js").default} */ (relationship)
        const hasManyPreloader = new BelongsToPreloader({models: this.models, relationship: belongsToRelationship})

        preloadResult = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasMany") {
        const hasManyRelationship = /** @type {import("../record/relationships/has-many.js").default} */ (relationship)
        const hasManyPreloader = new HasManyPreloader({models: this.models, relationship: hasManyRelationship})

        preloadResult = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasOne") {
        const hasOneRelationship = /** @type {import("../record/relationships/has-one.js").default} */ (relationship)
        const hasOnePreloader = new HasOnePreloader({models: this.models, relationship: hasOneRelationship})

        preloadResult = await hasOnePreloader.run()
      } else {
        throw new Error(`Unknown relationship type: ${relationship.getType()}`)
      }

      const targetModels = Array.isArray(preloadResult) ? preloadResult : (preloadResult?.targetModels || [])
      const targetModelsByClassName = Array.isArray(preloadResult) ? undefined : preloadResult?.targetModelsByClassName

      // Handle any further preloads in the tree
      const newPreload = this.preload[preloadRelationshipName]

      if (typeof newPreload == "object" && targetModels.length > 0) {
        if (relationship.getPolymorphic() && targetModelsByClassName) {
          const configuration = relationship.getConfiguration()

          for (const className in targetModelsByClassName) {
            const models = targetModelsByClassName[className]

            if (models.length == 0) continue

            const targetModelClass = configuration.getModelClass(className)
            const preloader = new VelociousDatabaseQueryPreloader({modelClass: targetModelClass, models, preload: newPreload})

            await preloader.run()
          }
        } else {
          const targetModelClass = relationship.getTargetModelClass()

          if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

          const preloader = new VelociousDatabaseQueryPreloader({modelClass: targetModelClass, models: targetModels, preload: newPreload})

          await preloader.run()
        }
      }
    }
  }
}
