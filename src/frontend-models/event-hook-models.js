// @ts-check

/**
 * FrontendModelInstance type.
 * @typedef {import("./base.js").default} FrontendModelInstance */

/**
 * Model dependency ids.
 * @type {WeakMap<FrontendModelInstance, number>} */
const modelDependencyIds = new WeakMap()
let nextModelDependencyId = 1

/**
 * Runs the modelsFromInput helper.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @returns {FrontendModelInstance[]} - Normalized model list.
 */
export function modelsFromInput(modelOrModels) {
  if (!modelOrModels) return []
  if (Array.isArray(modelOrModels)) return modelOrModels.filter(Boolean)

  return [modelOrModels]
}

/**
 * Runs model dependency id.
 * @param {FrontendModelInstance} model - Model instance.
 * @returns {number} - Stable dependency id for the model object.
 */
function modelDependencyId(model) {
  const existingId = modelDependencyIds.get(model)

  if (existingId) return existingId

  const id = nextModelDependencyId
  nextModelDependencyId += 1
  modelDependencyIds.set(model, id)

  return id
}

/**
 * Runs the modelsDependencyKey helper.
 * @param {FrontendModelInstance | FrontendModelInstance[] | null | undefined} modelOrModels - Model or models.
 * @returns {string} - Stable dependency key.
 */
export function modelsDependencyKey(modelOrModels) {
  return JSON.stringify(modelsFromInput(modelOrModels).map((model) => [model.primaryKeyValue(), modelDependencyId(model)]))
}
