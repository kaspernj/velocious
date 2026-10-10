// @ts-check

import fs from "node:fs/promises"
import path from "node:path"

/**
 * Serves a static file from `root` directory to the response as a
 * length-determined body (no chunked transfer-encoding).
 *
 * This is the proxy-safe alternative to `response.setFilePath()` /
 * `response.stream()`: the file is read into memory and sent with an
 * explicit `Content-Length` header, which avoids issues with proxies
 * (e.g. Rollbridge) that do not support chunked transfer encoding.
 * @param {import("./response.js").default} response
 *   The HTTP response to write to.
 * @param {string} root - Absolute directory path that files must live under.
 * @param {string} name - File name (or relative path) to serve from within `root`.
 * @param {object} [options] - Serving options.
 * @param {string} [options.contentType] - MIME type to set on the response.
 * @param {string} [options.cacheControl] - Value for the `Cache-Control` header.
 * @returns {Promise<boolean>} - `true` if the file was served, `false` if the
 *   file was not found or the name resolved outside the root (404 set in both cases).
 */
export default async function serveFile(response, root, name, options = {}) {
  const {contentType, cacheControl} = options

  // Reject empty or null names.
  if (!name || typeof name !== "string") {
    response.setStatus(404)
    return false
  }

  // Resolve the target path and verify it stays within root.
  const resolvedRoot = path.resolve(root)
  const targetPath = path.resolve(resolvedRoot, name)

  // Path containment check: the resolved target must be inside root.
  if (targetPath !== resolvedRoot && !targetPath.startsWith(resolvedRoot + path.sep)) {
    response.setStatus(404)
    return false
  }

  // lstat to reject symlinks and confirm the path is a regular file.
  let stat
  try {
    stat = await fs.lstat(targetPath)
  } catch {
    response.setStatus(404)
    return false
  }

  if (!stat.isFile() || stat.isSymbolicLink()) {
    response.setStatus(404)
    return false
  }

  const data = await fs.readFile(targetPath)

  response.setBody(data)
  response.setHeader("Content-Type", contentType || "application/octet-stream")
  response.setHeader("Cache-Control", cacheControl || "no-store")

  return true
}
