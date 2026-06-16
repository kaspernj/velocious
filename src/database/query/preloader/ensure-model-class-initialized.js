// @ts-check

/**
 * Runs ensure model class initialized.
 * @param {typeof import("../../record/index.js").default} modelClass - Model class to initialize.
 * @param {import("../../../configuration.js").default} configuration - Current configuration.
 * @returns {Promise<void>} - Resolves when the model class is initialized.
 */
export default async function ensureModelClassInitialized(modelClass, configuration) {
  if (modelClass.isInitialized()) return

  await modelClass.ensureInitialized({configuration})
}
