import {createRequire} from "node:module"
import path from "node:path"
import SqlJsWasmRouteController from "./sqljs-wasm-route-controller.js"

const require = createRequire(import.meta.url)
const sqlJsEntryPath = require.resolve("sql.js")
const sqlJsDistDirectory = path.dirname(sqlJsEntryPath)

/**
 * @typedef {object} InstallSqlJsWasmRouteArgs
 * @property {import("../configuration.js").default} configuration - Velocious configuration instance.
 * @property {string} [routePrefix] - Route prefix used for sql.js asset serving.
 */

/**
 * @typedef {object} SqlJsLocateFileFromBackendArgs
 * @property {string} backendBaseUrl - Backend base URL (for example `https://api.example.com`).
 * @property {string} [routePrefix] - Route prefix used for sql.js asset serving.
 */

/**
 * @param {string} routePrefix - Route prefix input.
 * @returns {string} - Normalized route prefix.
 */
function normalizeRoutePrefix(routePrefix) {
  if (!routePrefix.startsWith("/")) {
    throw new Error(`Expected route prefix to start with '/', got: ${routePrefix}`)
  }

  if (routePrefix.length > 1 && routePrefix.endsWith("/")) {
    return routePrefix.slice(0, -1)
  }

  return routePrefix
}

/**
 * Installs a route-resolver hook that serves `sql.js/dist/*` files from the running Velocious backend.
 * @param {InstallSqlJsWasmRouteArgs} args - Options object.
 * @returns {void} - No return value.
 */
export default function installSqlJsWasmRoute(args) {
  const {configuration, routePrefix = "/velocious/sqljs"} = args

  if (!configuration) throw new Error("No configuration given")

  const normalizedRoutePrefix = normalizeRoutePrefix(routePrefix)

  configuration.routes((routes) => {
    routes.get(`${normalizedRoutePrefix}/:sqlJsAssetFileName`, {
      params: {sqlJsDistDirectory},
      to: [SqlJsWasmRouteController, "show"]
    })
  })
}

/**
 * Creates a sqlite-web `locateFile(file)` callback pointing to a Velocious backend route.
 * @param {SqlJsLocateFileFromBackendArgs} args - Options object.
 * @returns {(file: string) => string} - sql.js locateFile callback.
 */
export function sqlJsLocateFileFromBackend(args) {
  const {backendBaseUrl, routePrefix = "/velocious/sqljs"} = args
  const normalizedRoutePrefix = normalizeRoutePrefix(routePrefix)
  const baseUrl = backendBaseUrl.replace(/\/+$/, "")

  return (file) => `${baseUrl}${normalizedRoutePrefix}/${encodeURIComponent(file)}`
}
