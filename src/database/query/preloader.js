import BelongsToPreloader from "./preloader/belongs-to.js"
import HasManyPreloader from "./preloader/has-many.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloader {
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
        const hasManyPreloader = new BelongsToPreloader({models: this.models, relationship: relationship})

        targetModels = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasMany") {
        const hasManyPreloader = new HasManyPreloader({models: this.models, relationship: relationship})

        targetModels = await hasManyPreloader.run()
      } else {
        throw new Error(`Unknown relationship type: ${relationship.getType()}`)
      }

      // Handle any further preloads in the tree
      const newPreload = this.preload[preloadRelationshipName]

      if (typeof newPreload == "object" && targetModels.length > 0) {
        const preloader = new VelociousDatabaseQueryPreloader({modelClass: relationship.getTargetModelClass(), models: targetModels, preload: newPreload})

        await preloader.run()
      }
    }
  }
}
