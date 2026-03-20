// @ts-check

/**
 * @param {Record<string, {default?: unknown}>} modules - Modules keyed by require-context path.
 * @returns {{(id: string): {default?: unknown}, keys: () => string[]}} - Webpack-style require context.
 */
export function buildRequireContext(modules) {
  /**
   * @param {string} id - Module id.
   * @returns {{default?: unknown}} - Imported module.
   */
  function requireContext(id) {
    const loadedModule = modules[id]

    if (!loadedModule) {
      throw new Error(`Missing module in require context: ${id}`)
    }

    return loadedModule
  }

  requireContext.keys = () => Object.keys(modules)

  return requireContext
}
