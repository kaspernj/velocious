// @ts-check

import zlib from "node:zlib"
import {promisify} from "node:util"

const brotliCompressAsync = promisify(zlib.brotliCompress)
const gzipAsync = promisify(zlib.gzip)

/**
 * Exact media types (beyond the text/*, *+json, and *+xml families) that are worth compressing.
 * Everything else — unknown binary types and commonly pre-compressed media such as images,
 * video, and archives — is left untouched by the conservative allowlist.
 * @type {Set<string>} */
const COMPRESSIBLE_EXACT_MEDIA_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/json",
  "application/x-javascript",
  "application/xml",
  "image/svg+xml"
])

/**
 * RFC 9110 §12.4.2 qvalue grammar: `0` or `1` with at most three fractional
 * digits, and only zeros after `1`.
 * @type {RegExp} */
const QVALUE_PATTERN = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/u

/**
 * Runs parse accept encoding.
 * @param {string} headerValue - Accept-Encoding header value.
 * @returns {Map<string, number>} - Lowercased coding to q-value (0-1).
 */
export function parseAcceptEncoding(headerValue) {
  /** @type {Map<string, number>} */
  const codings = new Map()

  for (const part of headerValue.split(",")) {
    const [codingToken, ...parameters] = part.split(";")
    const coding = codingToken?.trim().toLowerCase()

    if (!coding) continue

    let q = 1

    for (const parameter of parameters) {
      const [name, value] = parameter.split("=")

      if (name?.trim().toLowerCase() != "q") continue

      const qvalue = value?.trim() || ""

      // A malformed q-value (e.g. `.5`, `01`, `1.001`, more than three fractional
      // digits, or empty) is treated as "not acceptable" (q=0), per RFC 9110 §12.4.2.
      q = QVALUE_PATTERN.test(qvalue) ? Number(qvalue) : 0
    }

    codings.set(coding, q)
  }

  return codings
}

/**
 * Negotiates the content coding for a response from the Accept-Encoding header.
 * Identity participates in the same quality comparison as the supported codings:
 * a higher-q identity selects identity, and equal-q ties break in server order
 * br, gzip, identity. Identity defaults to acceptable unless explicitly refused
 * with `identity;q=0` or a `*;q=0` wildcard without a more specific identity
 * entry, and an explicit coding entry beats the wildcard.
 * @param {string | null | undefined} acceptEncoding - Accept-Encoding header value.
 * @returns {{encoding: "br" | "gzip" | "identity", identityAcceptable: boolean} | {notAcceptable: true}} - Negotiated coding, or that no acceptable representation exists.
 */
export function negotiateContentEncoding(acceptEncoding) {
  if (acceptEncoding === undefined || acceptEncoding === null || acceptEncoding.trim() === "") {
    return {encoding: "identity", identityAcceptable: true}
  }

  const codings = parseAcceptEncoding(acceptEncoding)
  const wildcardQ = codings.get("*")
  const identityQ = codings.get("identity") ?? wildcardQ ?? 1

  // Declared in server preference order; the stable sort keeps this order for ties.
  /** @type {Array<{coding: "br" | "gzip" | "identity", q: number}>} */
  const candidates = [
    {coding: "br", q: codings.get("br") ?? wildcardQ ?? 0},
    {coding: "gzip", q: codings.get("gzip") ?? wildcardQ ?? 0},
    {coding: "identity", q: identityQ}
  ]
  const selected = candidates
    .filter((candidate) => candidate.q > 0)
    .sort((a, b) => b.q - a.q)[0]

  if (!selected) return {notAcceptable: true}

  return {encoding: selected.coding, identityAcceptable: identityQ > 0}
}

/**
 * Runs is compressible content type.
 * @param {string} contentType - Content-Type header value.
 * @returns {boolean} - Whether the media type is on the compressible allowlist.
 */
export function isCompressibleContentType(contentType) {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase()

  if (!mediaType) return false

  // Server-sent events are long-lived streams; buffering them for compression
  // would break delivery, so they are excluded before the textual allowlist.
  if (mediaType == "text/event-stream") return false
  if (mediaType.startsWith("text/")) return true
  if (mediaType.endsWith("+json") || mediaType.endsWith("+xml")) return true

  return COMPRESSIBLE_EXACT_MEDIA_TYPES.has(mediaType)
}

/**
 * Merges Accept-Encoding into the response Vary header case-insensitively and
 * without duplicates. An existing `Vary: *` already covers every request header
 * and is preserved as-is.
 * @param {import("./response.js").default} response - Response instance.
 * @returns {void} - No return value.
 */
export function addAcceptEncodingToVary(response) {
  for (const headerKey in response.headers) {
    if (headerKey.toLowerCase() != "vary") continue

    const values = response.headers[headerKey]
    const tokens = values.flatMap((value) => value.split(",").map((token) => token.trim().toLowerCase()))

    if (tokens.includes("*") || tokens.includes("accept-encoding")) return

    if (values.length > 0) {
      values[0] = `${values[0]}, Accept-Encoding`
    }

    return
  }

  response.setHeader("Vary", "Accept-Encoding")
}

/**
 * Negotiates and applies compression to a buffered response body immediately before
 * framing. Only string/Uint8Array responses reach this point; sendFile responses and
 * bodyless statuses are excluded by the caller. Transformation is skipped for
 * Cache-Control no-transform, non-allowlisted or pre-compressed media types,
 * server-sent events, partial (206) responses, requests with a Range header,
 * responses with a Content-Range header, and per-response opt-outs; a skipped
 * transformation is still sent as identity when the client accepts identity, and
 * answered "not-acceptable" when it does not. Responses that already carry an
 * application-supplied Content-Encoding are passed through unchanged and never
 * negotiate. When the client forbids every representation (identity and all
 * supported codings), the outcome is "not-acceptable".
 * @param {object} args - Options object.
 * @param {Buffer} args.bodyBuffer - Buffered response body bytes (UTF-8 encoded for string bodies).
 * @param {import("../../configuration-types.js").NormalizedHttpCompressionConfiguration} args.compression - Normalized compression configuration.
 * @param {import("./request.js").default | import("./websocket-request.js").default} args.request - Request object.
 * @param {import("./response.js").default} args.response - Response instance.
 * @returns {Promise<{outcome: "identity"} | {outcome: "compressed", body: Buffer} | {outcome: "not-acceptable"}>} - Compression outcome.
 */
export async function applyResponseCompression({bodyBuffer, compression, request, response}) {
  if (!compression.enabled) return {outcome: "identity"}

  // Application-supplied encodings stay application-owned: they are passed through
  // unchanged and never take part in negotiation failure handling.
  if (response.getHeader("Content-Encoding").length > 0) return {outcome: "identity"}

  const negotiated = negotiateContentEncoding(request.header("accept-encoding"))

  if ("notAcceptable" in negotiated) return {outcome: "not-acceptable"}

  const cacheControlTokens = response.getHeader("Cache-Control")
    .flatMap((value) => value.split(","))
    .map((token) => token.trim().toLowerCase())
  const contentType = response.getHeader("Content-Type")[0]
  const transformable = !response.isCompressionDisabled() &&
    response.getStatusCode() !== 206 &&
    !request.header("range") &&
    response.getHeader("Content-Range").length === 0 &&
    !cacheControlTokens.includes("no-transform") &&
    contentType !== undefined &&
    isCompressibleContentType(contentType)

  if (!transformable) {
    // A skipped transformation may still go out as identity when the client accepts
    // identity; when identity is forbidden, no acceptable representation can be sent.
    return negotiated.identityAcceptable ? {outcome: "identity"} : {outcome: "not-acceptable"}
  }

  // The representation now depends on the request's Accept-Encoding, even when this
  // particular response ends up identity (missing header, higher-q identity, below threshold).
  addAcceptEncodingToVary(response)

  if (negotiated.encoding == "identity") return {outcome: "identity"}

  // Below the threshold the smaller identity representation is sent instead — but only
  // when identity is acceptable; a client that forbids identity must never be forced
  // onto an unacceptable representation by the size check.
  if (bodyBuffer.length < compression.threshold && negotiated.identityAcceptable) return {outcome: "identity"}

  const body = negotiated.encoding == "br"
    ? await brotliCompressAsync(bodyBuffer, {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: compression.brotliQuality}})
    : await gzipAsync(bodyBuffer, {level: compression.gzipLevel})

  response.setHeader("Content-Encoding", negotiated.encoding)

  return {body, outcome: "compressed"}
}
