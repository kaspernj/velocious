// @ts-check

import UploadedFile from "../../../http-server/client/uploaded-file/uploaded-file.js"
import fs from "fs/promises"
import path from "path"

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Uint8Array} - Whether value is a byte array.
 */
function isUint8Array(value) {
  return value instanceof Uint8Array
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is ArrayBuffer} - Whether value is array buffer.
 */
function isArrayBuffer(value) {
  return value instanceof ArrayBuffer
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is {arrayBuffer: () => Promise<ArrayBuffer>}} - Whether value supports arrayBuffer().
 */
function isArrayBufferLike(value) {
  return Boolean(value && typeof value === "object" && typeof /** @type {any} */ (value).arrayBuffer === "function")
}

/**
 * @param {string} filePath - File path.
 * @param {string[]} allowedPathPrefixes - Allowed path prefixes.
 * @returns {boolean} - Whether path is allowed.
 */
function pathWithinAllowedPrefixes(filePath, allowedPathPrefixes) {
  const resolvedPath = path.resolve(filePath)

  return allowedPathPrefixes.some((allowedPrefix) => {
    const resolvedPrefix = path.resolve(allowedPrefix)
    const relativePath = path.relative(resolvedPrefix, resolvedPath)

    if (!relativePath) return true
    if (relativePath.startsWith("..")) return false
    if (path.isAbsolute(relativePath)) return false

    return true
  })
}

/**
 * @param {Uint8Array | Buffer | ArrayBuffer | string} value - Value.
 * @returns {Buffer} - Buffer value.
 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === "string") return Buffer.from(value)
  if (isArrayBuffer(value)) return Buffer.from(value)
  if (isUint8Array(value)) return Buffer.from(value)

  throw new Error("Unsupported attachment content type")
}

/**
 * @param {UploadedFile} uploadedFile - Uploaded file.
 * @returns {Promise<Buffer>} - File content buffer.
 */
async function uploadedFileBuffer(uploadedFile) {
  const memoryBuffer = /** @type {{getBuffer?: () => Buffer}} */ (uploadedFile).getBuffer?.()

  if (Buffer.isBuffer(memoryBuffer)) return memoryBuffer

  const tempPath = /** @type {{getPath?: () => string}} */ (uploadedFile).getPath?.()

  if (typeof tempPath === "string" && tempPath.length > 0) {
    return await fs.readFile(tempPath)
  }

  throw new Error("Unsupported uploaded file type")
}

/**
 * @typedef {object} NormalizedAttachmentInput
 * @property {number} byteSize - File size in bytes.
 * @property {Buffer} contentBuffer - Raw content bytes.
 * @property {string} contentBase64 - Base64 encoded content.
 * @property {string | null} contentType - Content type.
 * @property {string} filename - Filename.
 */

/**
 * @param {unknown} input - Attachment input.
 * @param {object} [args] - Options.
 * @param {boolean} [args.allowPathInput] - Whether `{path: ...}` input is allowed.
 * @param {string[]} [args.allowedPathPrefixes] - Optional allowlist for path input.
 * @param {string} [args.defaultFilename] - Optional default filename.
 * @returns {Promise<NormalizedAttachmentInput>} - Normalized attachment input.
 */
export default async function normalizeRecordAttachmentInput(input, args = {}) {
  const defaultFilename = args.defaultFilename || "attachment.bin"
  /** @type {Buffer} */
  let buffer
  /** @type {string | null} */
  let contentType = null
  /** @type {string | undefined} */
  let filename

  if (input instanceof UploadedFile) {
    buffer = await uploadedFileBuffer(input)
    filename = input.filename()
    contentType = input.contentType() || null
  } else if (isPlainObject(input) && typeof input.path === "string" && input.path.length > 0) {
    if (args.allowPathInput !== true) {
      throw new Error("Attachment path input is disabled")
    }

    const filePath = path.resolve(input.path)
    const allowedPathPrefixes = Array.isArray(args.allowedPathPrefixes)
      ? args.allowedPathPrefixes.filter((entry) => typeof entry === "string" && entry.length > 0)
      : []

    if (allowedPathPrefixes.length > 0 && !pathWithinAllowedPrefixes(filePath, allowedPathPrefixes)) {
      throw new Error("Attachment path is outside allowed directories")
    }

    buffer = await fs.readFile(filePath)
    filename = typeof input.filename === "string" && input.filename.length > 0 ? input.filename : path.basename(filePath)
    contentType = typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null
  } else if (isPlainObject(input) && typeof input.contentBase64 === "string") {
    buffer = Buffer.from(input.contentBase64, "base64")
    filename = typeof input.filename === "string" && input.filename.length > 0 ? input.filename : defaultFilename
    contentType = typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null
  } else if (isPlainObject(input) && "content" in input) {
    buffer = toBuffer(input.content)
    filename = typeof input.filename === "string" && input.filename.length > 0 ? input.filename : defaultFilename
    contentType = typeof input.contentType === "string" && input.contentType.length > 0 ? input.contentType : null
  } else if (isArrayBufferLike(input)) {
    const arrayBuffer = await input.arrayBuffer()

    buffer = Buffer.from(arrayBuffer)
    filename = typeof /** @type {any} */ (input).name === "string" && /** @type {any} */ (input).name.length > 0
      ? /** @type {any} */ (input).name
      : defaultFilename
    contentType = typeof /** @type {any} */ (input).type === "string" && /** @type {any} */ (input).type.length > 0
      ? /** @type {any} */ (input).type
      : null
  } else if (typeof input === "string" || Buffer.isBuffer(input) || isArrayBuffer(input) || isUint8Array(input)) {
    buffer = toBuffer(input)
    filename = defaultFilename
  } else {
    throw new Error("Unsupported attachment input")
  }

  const normalizedFilename = typeof filename === "string" && filename.length > 0 ? path.basename(filename) : defaultFilename

  return {
    byteSize: buffer.length,
    contentBuffer: buffer,
    contentBase64: buffer.toString("base64"),
    contentType,
    filename: normalizedFilename
  }
}
