// @ts-check

import path from "path"
import {pathToFileURL} from "url"

/**
 * @param {string} value - Path or import specifier.
 * @returns {boolean} - Whether value is a Windows absolute path.
 */
function isWindowsAbsolutePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")
}

/**
 * @param {string} windowsPath - Windows absolute path.
 * @returns {string} - File URL.
 */
function windowsPathToFileUrl(windowsPath) {
  const normalized = windowsPath.replaceAll("\\", "/")

  if (normalized.startsWith("//")) {
    const uncPath = normalized.replace(/^\/+/, "")
    const [host, ...pathParts] = uncPath.split("/")
    const url = new URL(`file://${host}/`)

    url.pathname = `/${pathParts.join("/")}`

    return url.href
  }

  const url = new URL("file:///")

  url.pathname = `/${normalized}`

  return url.href
}

/**
 * Converts a filesystem path to a dynamic-import safe specifier across platforms.
 * Leaves package names and relative specifiers unchanged.
 * @param {string} value - Import specifier or filesystem path.
 * @returns {string} - Import specifier safe for dynamic import.
 */
export default function toImportSpecifier(value) {
  if (value.match(/^(node|data|file):/)) return value
  if (value.startsWith("./") || value.startsWith("../")) return value
  if (isWindowsAbsolutePath(value)) return windowsPathToFileUrl(value)
  if (path.isAbsolute(value)) return pathToFileURL(value).href

  return value
}
