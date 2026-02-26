import fs from "node:fs/promises"
import path from "node:path"

import Controller from "../controller.js"

/**
 * @param {unknown} assetFileName - Asset file name.
 * @returns {boolean} - Whether asset file name is safe.
 */
function validAssetFileName(assetFileName) {
  return typeof assetFileName === "string"
    && assetFileName.length > 0
    && !assetFileName.includes("/")
    && !assetFileName.includes("\\")
    && !assetFileName.includes("..")
}

/**
 * @param {string} assetFileName - Requested sql.js asset file name.
 * @returns {string} - Normalized sql.js asset file name.
 */
function normalizeSqlJsAssetFileName(assetFileName) {
  if (assetFileName === "sql-wasm-browser.wasm") {
    return "sql-wasm.wasm"
  }

  return assetFileName
}

/** Serves sql.js assets from the backend for sqlite-web locateFile callbacks. */
export default class SqlJsWasmRouteController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async show() {
    const {sqlJsAssetFileName, sqlJsDistDirectory} = this.params()

    if (!validAssetFileName(sqlJsAssetFileName)) {
      throw new Error(`Invalid sql.js asset file name: ${String(sqlJsAssetFileName)}`)
    }

    if (typeof sqlJsDistDirectory !== "string" || sqlJsDistDirectory.length < 1) {
      throw new Error(`Expected sql.js dist directory path to be a string, got: ${String(sqlJsDistDirectory)}`)
    }

    const normalizedSqlJsAssetFileName = normalizeSqlJsAssetFileName(sqlJsAssetFileName)
    const assetPath = path.join(sqlJsDistDirectory, normalizedSqlJsAssetFileName)

    try {
      await fs.access(assetPath)
    } catch (error) {
      const ensuredError = /** @type {{code?: string}} */ (error)

      if (ensuredError.code === "ENOENT") {
        await this.render({json: {errorMessage: "Not found", status: "error"}, status: "not-found"})
        return
      }

      throw error
    }

    this.response().setHeader("Cache-Control", "public, max-age=3600")
    this.sendFile(assetPath)
  }
}
