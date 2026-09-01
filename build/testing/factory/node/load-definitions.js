// @ts-check

import { pathToFileURL } from "node:url"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { reserveDefinitionReloadBudget } from "./definition-reload-policy.js"

/**
 * Monotonic cache-busting counter shared by reloads. Kept module-local so a reload
 * imports a fresh module instance rather than the cached one.
 * @type {number}
 */
let reloadCounter = 0

/**
 * Recursively collects `.js` files under a directory in a deterministic
 * (lexicographically sorted) order.
 * @param {string} directory - Directory to scan.
 * @returns {Promise<string[]>} - Sorted absolute file paths.
 */
async function collectDirectoryFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true})
  /** @type {string[]} */
  const files = []

  for (const entry of [...entries].sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectDirectoryFiles(fullPath))
    } else if (entry.name.endsWith(".js")) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Resolves a load target (a single file, a directory, or an explicit list) into a
 * deterministic, de-duplicated list of absolute definition file paths.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @returns {Promise<string[]>} - Sorted, de-duplicated absolute file paths.
 */
async function resolveFiles(target) {
  if (Array.isArray(target)) {
    return [...new Set(target.map((entry) => path.resolve(entry)))].sort()
  }

  const resolved = path.resolve(target)
  const stats = await stat(resolved)

  if (stats.isDirectory()) return await collectDirectoryFiles(resolved)

  return [resolved]
}

/**
 * Loads Velocious factory definition files (Node only). Each file must
 * default-export a `(registry) => void` function that defines into the registry.
 * Files load in deterministic path order. This module is intentionally Node-only
 * (filesystem + dynamic import) and must never be imported from browser/Metro
 * bundles; import the browser-safe core from `../index.js` there instead.
 * @param {import("../factory-registry.js").default} registry - Registry to define into.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @param {{reload?: boolean}} [options] - Options.
 * @returns {Promise<string[]>} - The loaded file paths, in load order.
 */
export async function loadDefinitions(registry, target, {reload = false} = {}) {
  const files = await resolveFiles(target)

  return await loadResolvedDefinitionFiles({files, registry, reload})
}

/**
 * Loads definition files that have already been resolved into a deterministic
 * sorted list. When `reload` is set, the whole batch is preflighted and reserved
 * against the process-global import budget before any registry reset or import
 * attempt, so a rejected reload never mutates the registry.
 * @param {object} args - Options object.
 * @param {string[]} args.files - Resolved, sorted definition file paths.
 * @param {import("../factory-registry.js").default} args.registry - Registry to define into.
 * @param {boolean} args.reload - Whether to cache-bust the imports.
 * @param {boolean} [args.reset] - Whether to reset the registry first.
 * @returns {Promise<string[]>} - The loaded file paths, in load order.
 */
async function loadResolvedDefinitionFiles({files, registry, reload, reset = false}) {
  if (reload) reserveDefinitionReloadBudget(files.length)

  if (reset) registry.reset()

  for (const file of files) {
    let href = pathToFileURL(file).href

    if (reload) {
      reloadCounter += 1
      href += `?factoryReload=${reloadCounter}`
    }

    const module = await import(href)

    if (typeof module.default !== "function") {
      throw new Error(`Factory definition file ${file} must default-export a (registry) => void function`)
    }

    module.default(registry)
  }

  return files
}

/**
 * Fully reloads definitions: resets the registry (dropping every factory, trait,
 * sequence, callback and default) and re-imports the target files with cache
 * busting so edited definitions take effect. The resolved batch is preflighted
 * against the process-global import budget before the reset, and a
 * `DefinitionRecycleRequiredError` is raised before any mutation when the batch
 * would exceed the budget.
 * @param {import("../factory-registry.js").default} registry - Registry to reload.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @returns {Promise<string[]>} - The reloaded file paths, in load order.
 */
export async function reloadDefinitions(registry, target) {
  const files = await resolveFiles(target)

  return await loadResolvedDefinitionFiles({files, registry, reload: true, reset: true})
}
