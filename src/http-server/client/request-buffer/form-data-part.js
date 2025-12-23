// @ts-check

import fs from "fs"
import path from "path"
import {tmpdir} from "os"
import MemoryUploadedFile from "../uploaded-file/memory-uploaded-file.js"
import TemporaryUploadedFile from "../uploaded-file/temporary-uploaded-file.js"

const MAX_IN_MEMORY_FILE_SIZE = 2 * 1024 * 1024

export default class FormDataPart {
  /** @type {Record<string, import("./header.js").default>} */
  headers = {}

  /** @type {number[]} */
  body = []

  /**
   * @param {import("./header.js").default} header
   */
  addHeader(header) {
    const name = header.formattedName

    this.headers[name] = header

    if (name == "content-disposition") {
      const match = header.value.match(/^form-data;\s*name="(.+?)"(?:;\s*filename="(.+?)")?$/)

      if (match) {
        this.name = match[1]
        this.filename = match[2]
      } else {
        console.error(`Couldn't match name from content-disposition: ${header.value}`)
      }
    } else if (name == "content-length") {
      this.contentLength = parseInt(header.value)
    } else if (name == "content-type") {
      this.contentType = header.value
    }
  }

  finish() {
    const buffer = Buffer.from(this.body)

    this.size = buffer.length

    if (this.isFile()) {
      this.value = this.buildUploadedFile(buffer)
    } else {
      this.value = buffer.toString()
    }

    this.body = []
  }

  buildUploadedFile(buffer) {
    const filename = this._sanitizeFilename(this.filename) || "upload"
    const fieldName = this.getName()
    const commonArgs = {
      contentType: this.contentType,
      fieldName,
      filename,
      size: this.size || buffer.length
    }

    if (buffer.length <= MAX_IN_MEMORY_FILE_SIZE) {
      return new MemoryUploadedFile({...commonArgs, buffer})
    }

    const tempFilePath = this.createTempFile(buffer, filename)

    return new TemporaryUploadedFile({...commonArgs, path: tempFilePath})
  }

  /**
   * @param {Buffer} buffer
   * @param {string} filename
   * @returns {string}
   */
  createTempFile(buffer, filename) {
    const tempDirectory = fs.mkdtempSync(path.join(tmpdir(), "velocious-upload-"))
    const tempFilePath = path.join(tempDirectory, filename)

    fs.writeFileSync(tempFilePath, buffer)

    return tempFilePath
  }

  /**
   * Prevent path traversal/absolute paths from filenames coming from headers.
   * @param {string | undefined} filename
   * @returns {string}
   */
  _sanitizeFilename(filename) {
    if (!filename) return ""

    const base = path.basename(filename)

    if (base === "." || base === ".." || base === "") return "upload"

    return base
  }

  getName() {
    if (!this.name) throw new Error("Name hasn't been set")

    return this.name
  }

  getValue() {
    if (typeof this.value === "undefined") throw new Error("Value hasn't been set")

    return this.value
  }

  isFile() { return Boolean(this.filename) }

  /**
   * @param {string} text
   */
  removeFromBody(text) {
    this.body = this.body.slice(0, this.body.length - text.length)
  }
}
