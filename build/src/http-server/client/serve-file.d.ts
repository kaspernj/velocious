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
export default function serveFile(response: import("./response.js").default, root: string, name: string, options?: {
    contentType?: string;
    cacheControl?: string;
}): Promise<boolean>;
//# sourceMappingURL=serve-file.d.ts.map