// @ts-check

/**
 * @param {object} args - Args.
 * @param {string} args.driverName - Driver name.
 * @param {string} args.methodName - Method name.
 * @returns {never} - Always throws.
 */
function throwMissingMethod({driverName, methodName}) {
  throw new Error(`Attachment storage driver "${driverName}" requires a "${methodName}" callback`)
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {Buffer} - Buffer value.
 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (typeof value === "string") return Buffer.from(value, "base64")

  throw new Error(`Unsupported native attachment read result: ${String(value)}`)
}

/**
 * Native attachment storage driver.
 * This driver delegates all I/O to user-provided callbacks.
 */
export default class NativeAttachmentStorageDriver {
  /**
   * @param {object} args - Options.
   * @param {import("../../../../configuration.js").default} [args.configuration] - Configuration instance.
   * @param {string} args.name - Driver name.
   * @param {Record<string, any>} [args.options] - Driver options.
   */
  constructor({configuration, name, options = {}}) {
    this.configuration = configuration
    this.name = name
    this.options = options
  }

  /**
   * @param {object} args - Write args.
   * @param {string} args.attachmentId - Attachment id.
   * @param {{contentBase64: string, contentType: string | null, filename: string}} args.input - Normalized attachment input.
   * @param {import("../../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @returns {Promise<{storageKey: string}>} - Storage key result.
   */
  async write({attachmentId, input, model, name}) {
    if (typeof this.options.write !== "function") {
      throwMissingMethod({driverName: this.name, methodName: "write"})
    }

    const result = await this.options.write({
      attachmentId,
      attachmentName: name,
      contentBase64: input.contentBase64,
      contentType: input.contentType,
      filename: input.filename,
      model
    })

    if (!result || typeof result.storageKey !== "string" || result.storageKey.length < 1) {
      throw new Error(`Attachment storage driver "${this.name}" write callback must return {storageKey}`)
    }

    return {storageKey: result.storageKey}
  }

  /**
   * @param {object} args - Read args.
   * @param {string} args.storageKey - Storage key.
   * @param {import("../../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} args.row - Attachment row.
   * @returns {Promise<Buffer>} - Attachment bytes.
   */
  async read({model, name, row, storageKey}) {
    if (typeof this.options.read !== "function") {
      throwMissingMethod({driverName: this.name, methodName: "read"})
    }

    const result = await this.options.read({
      attachmentId: row.id || "",
      attachmentName: name,
      model,
      row,
      storageKey
    })

    return toBuffer(result)
  }

  /**
   * @param {object} args - Delete args.
   * @param {string} args.storageKey - Storage key.
   * @param {import("../../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} args.row - Attachment row.
   * @returns {Promise<void>} - Resolves when deleted.
   */
  async delete({model, name, row, storageKey}) {
    if (typeof this.options.delete !== "function") return

    await this.options.delete({
      attachmentId: row.id || "",
      attachmentName: name,
      model,
      row,
      storageKey
    })
  }

  /**
   * @param {object} args - URL args.
   * @param {string} args.storageKey - Storage key.
   * @param {import("../../index.js").default} args.model - Model instance.
   * @param {string} args.name - Attachment name.
   * @param {Record<string, any>} args.row - Attachment row.
   * @returns {Promise<string | null>} - Attachment URL.
   */
  async url({model, name, row, storageKey}) {
    if (typeof this.options.url !== "function") return null

    const value = await this.options.url({
      attachmentId: row.id || "",
      attachmentName: name,
      model,
      row,
      storageKey
    })

    if (typeof value === "string" && value.length > 0) return value

    return null
  }
}
