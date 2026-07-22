// @ts-check

import {pathToFileURL} from "node:url"
import {readdir, stat} from "node:fs/promises"
import path from "node:path"

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
 * busting so edited definitions take effect.
 * @param {import("../factory-registry.js").default} registry - Registry to reload.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @returns {Promise<string[]>} - The reloaded file paths, in load order.
 */
export async function reloadDefinitions(registry, target) {
  registry.reset()

  return await loadDefinitions(registry, target, {reload: true})
}
