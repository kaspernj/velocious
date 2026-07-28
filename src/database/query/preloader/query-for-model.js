// @ts-check

/**
 * Builds a target query preserving the explicit database operation owned by
 * the source records.
 * @template {typeof import("../../record/index.js").default} MC
 * @param {import("../../record/index.js").default[]} models - Source records.
 * @param {MC} ModelClass - Target model class.
 * @returns {import("../model-class-query.js").default<MC>} - Target query.
 */
export default function preloadQueryForModel(models, ModelClass) {
  const sourceModel = models[0]

  if (!sourceModel) throw new Error("Cannot build a preload query without source records")

  return sourceModel.queryForModel(ModelClass)
}
